import {
    BrowserClient,
    defaultStackParser,
    getDefaultIntegrations,
    makeFetchTransport,
    Scope,
    logger,
    metrics,
    captureFeedback,
} from '@sentry/browser'
import type { Event, ExceptionMetadata } from './sentry_event'
import { Settings } from './element/settings'
import { Configuration } from './configuration'

// filter integrations that use the global variable
const integrations = getDefaultIntegrations({}).filter(defaultIntegration => {
    return !['BrowserApiErrors', 'TryCatch', 'GlobalHandlers'].includes(defaultIntegration.name)
})

// ref. https://docs.sentry.io/platforms/javascript/best-practices/shared-environments/
const client = new BrowserClient({
    dsn: process.env.SENTRY_DSN,
    transport: makeFetchTransport,
    stackParser: defaultStackParser,
    integrations: integrations,
    enableLogs: true,
    environment: process.env.ENV_NAME,
    release: `${process.env.PKG_NAME}@${process.env.VERSION}`,
})

const getScope = (() => {
    const scope = new Scope()
    scope.setClient(client)
    return () => {
        const config = Settings.getConfiguration()
        if (!config.enableBugTracking) return
        scope.setUser({ id: config.userId })
        scope.setAttribute('version', process.env.VERSION)
        return scope
    }
})()

client.init() // initializing has to be done after setting the client on the scope

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
        if (value === undefined) continue
        const newKey = prefix ? `${prefix}.${key}` : key
        if (isRecord(value)) {
            Object.assign(result, flatten(value, newKey))
        } else {
            result[newKey] = value
        }
    }
    return result
}

export function sendException(e: unknown, meta: ExceptionMetadata) {
    console.debug('sentry:', e)
    const { exceptionSource, additionalMetadata } = meta
    getScope()?.captureException(e, { captureContext: { tags: { ...additionalMetadata, exceptionSource } } })
}

export type FeedbackType = 'bug-report' | 'feature-request'
export function sendFeedback(feedback: { feedbackType: FeedbackType; message: string }): boolean {
    const scope = getScope()
    if (scope == null) return false
    const { message, feedbackType } = feedback
    const config = Settings.getConfiguration()
    captureFeedback(
        {
            message,
            tags: { feedbackType, ...flatten(Configuration.filterForReport(config), 'config') },
        },
        {},
        scope,
    )
    return true
}

const METRICS = {
    START: 'recording.start',
    DURATION: 'recording.duration',
    FILESIZE: 'recording.filesize',
    EXTERNAL_LINK: 'external_link.click',
    AGREE_TERMS: 'terms.agree',
}

export function sendEvent(e: Event) {
    const scope = getScope()
    if (scope == null) return

    switch (e.type) {
        case 'start_recording':
            metrics.count(METRICS.START, 1, {
                scope,
                attributes: { ...flatten(e.tags) },
            })
            const config = Settings.getConfiguration()
            logger.info(
                e.type,
                {
                    ...flatten(e.tags),
                    ...flatten(Configuration.filterForReport(config), 'config'),
                },
                { scope },
            )
            break

        case 'stop_recording':
            metrics.distribution(METRICS.DURATION, e.metrics.recording.durationSec, {
                scope,
                unit: 'second',
            })
            metrics.distribution(METRICS.FILESIZE, e.metrics.recording.filesize, {
                scope,
                unit: 'byte',
            })
            logger.info(e.type, { ...flatten(e.metrics) }, { scope })
            break

        case 'unexpected_stop':
            metrics.distribution(METRICS.DURATION, e.metrics.recording.durationSec, {
                scope,
                unit: 'second',
            })
            logger.info(e.type, { ...flatten(e.metrics) }, { scope })
            break

        case 'click_external_link':
            metrics.count(METRICS.EXTERNAL_LINK, 1, {
                scope,
                attributes: { ...flatten(e.tags) },
            })
            logger.info(e.type, { ...flatten(e.tags) }, { scope })
            break

        case 'migration_start':
            logger.info(e.type, { ...flatten(e.metrics) }, { scope })
            break

        case 'migration_end':
            logger.info(e.type, { ...flatten(e.metrics) }, { scope })
            break

        case 'agree_terms':
            metrics.count(METRICS.AGREE_TERMS, 1, { scope })
            logger.info(e.type, {}, { scope })
            break
    }
}

// Flushing is generally fire-and-forget, but must be awaited when called
// right before the Offscreen Document is closed; otherwise pending events
// may be lost.
export async function flush() {
    const ok = await client.flush(1000) // timeout 1s
    if (!ok) {
        console.error('sentry: flush failed')
    }
}
