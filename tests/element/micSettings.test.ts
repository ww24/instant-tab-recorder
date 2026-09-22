import { render } from 'vitest-browser-lit'
import { html } from 'lit'
import { describe, test, expect, vi, afterEach } from 'vitest'
import { shadowQuery, elementUpdated } from './test-helpers'
import '../../src/element/micSettings'
import { MicSettings } from '../../src/element/micSettings'

describe('mic-settings', () => {
    afterEach(async () => {
        const elements = document.querySelectorAll('mic-settings')
        for (const el of elements) {
            await (el as MicSettings).stopMicLevelMeter()
        }
    })
    test('renders status, volume slider, and level meter', async () => {
        const screen = render(html`<mic-settings .gain=${1}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        await elementUpdated(el)

        const status = shadowQuery(el, '.mic-status')
        expect(status).not.toBeNull()

        const slider = shadowQuery(el, '#mic-gain')
        expect(slider).not.toBeNull()

        const meter = shadowQuery(el, '.mic-level-meter-container')
        expect(meter).not.toBeNull()

        const label = shadowQuery(el, '.mic-level-meter-label')
        expect(label).not.toBeNull()
        expect(label?.textContent?.trim()).not.toBe('')
    })

    test('renders device select when availableMicrophones is non-empty', async () => {
        const screen = render(html`<mic-settings .gain=${1}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        el.availableMicrophones = [{ deviceId: 'mic-1', label: 'USB Mic' }] as MediaDeviceInfo[]
        await elementUpdated(el)

        const deviceSelect = shadowQuery(el, '#mic-device')
        expect(deviceSelect).not.toBeNull()
    })

    test('dispatches gain-change event on slider input', async () => {
        const screen = render(html`<mic-settings .gain=${1}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        await elementUpdated(el)

        const startMeterSpy = vi.spyOn(el, 'startMicLevelMeter').mockResolvedValue()
        const gainChangeSpy = vi.fn()
        el.addEventListener('gain-change', gainChangeSpy)

        const slider = shadowQuery(el, '#mic-gain') as any
        expect(slider).not.toBeNull()
        slider.value = 2.5
        slider.dispatchEvent(new Event('input'))

        expect(gainChangeSpy).toHaveBeenCalled()
        const customEvent = gainChangeSpy.mock.calls[0][0] as CustomEvent
        expect(customEvent.detail.gain).toBe(2.5)
        expect(startMeterSpy).toHaveBeenCalled()
    })

    test('dispatches device-change event on device select input', async () => {
        const screen = render(html`<mic-settings .gain=${1}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        el.availableMicrophones = [{ deviceId: 'mic-1', label: 'USB Mic' }] as MediaDeviceInfo[]
        await elementUpdated(el)

        const startMeterSpy = vi.spyOn(el, 'startMicLevelMeter').mockResolvedValue()
        const deviceChangeSpy = vi.fn()
        el.addEventListener('device-change', deviceChangeSpy)

        const deviceSelect = shadowQuery(el, '#mic-device') as any
        expect(deviceSelect).not.toBeNull()
        deviceSelect.value = 'mic-1'
        deviceSelect.dispatchEvent(new Event('input'))

        expect(deviceChangeSpy).toHaveBeenCalled()
        const customEvent = deviceChangeSpy.mock.calls[0][0] as CustomEvent
        expect(customEvent.detail.deviceId).toBe('mic-1')
        expect(startMeterSpy).toHaveBeenCalled()
    })

    test('does not activate mic level meter automatically on connect', async () => {
        const getUserMediaSpy = vi.spyOn(navigator.mediaDevices, 'getUserMedia')

        const screen = render(html`<mic-settings .gain=${1}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        await elementUpdated(el)

        expect(el.micMeterActive).toBe(false)
        expect(getUserMediaSpy).not.toHaveBeenCalled()
        getUserMediaSpy.mockRestore()
    })

    test('activates mic level meter when startMicLevelMeter is called with valid audio stream', async () => {
        const testCtx = new AudioContext()
        const osc = testCtx.createOscillator()
        const dst = testCtx.createMediaStreamDestination()
        osc.connect(dst)
        osc.start()

        const getUserMediaSpy = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(dst.stream)

        const screen = render(html`<mic-settings .gain=${1}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        await elementUpdated(el)

        expect(el.micMeterActive).toBe(false)

        await el.startMicLevelMeter()

        await vi.waitFor(() => {
            expect(el.micMeterActive).toBe(true)
        })

        osc.stop()
        await testCtx.close()
        await el.stopMicLevelMeter()
        getUserMediaSpy.mockRestore()
    })

    test('activates mic level meter on slider input when initially inactive', async () => {
        const testCtx = new AudioContext()
        const osc = testCtx.createOscillator()
        const dst = testCtx.createMediaStreamDestination()
        osc.connect(dst)
        osc.start()

        const getUserMediaSpy = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(dst.stream)

        const screen = render(html`<mic-settings .gain=${1}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        await elementUpdated(el)

        expect(el.micMeterActive).toBe(false)

        const slider = shadowQuery(el, '#mic-gain') as any
        slider.value = 1.5
        slider.dispatchEvent(new Event('input'))

        await vi.waitFor(() => {
            expect(el.micMeterActive).toBe(true)
        })

        osc.stop()
        await testCtx.close()
        await el.stopMicLevelMeter()
        getUserMediaSpy.mockRestore()
    })

    test('activates mic level meter on device select input when initially inactive', async () => {
        const testCtx = new AudioContext()
        const osc = testCtx.createOscillator()
        const dst = testCtx.createMediaStreamDestination()
        osc.connect(dst)
        osc.start()

        const getUserMediaSpy = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(dst.stream)

        const screen = render(html`<mic-settings .gain=${1}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        el.availableMicrophones = [{ deviceId: 'mic-1', label: 'USB Mic' }] as MediaDeviceInfo[]
        await elementUpdated(el)

        expect(el.micMeterActive).toBe(false)

        const deviceSelect = shadowQuery(el, '#mic-device') as any
        deviceSelect.value = 'mic-1'
        deviceSelect.dispatchEvent(new Event('input'))

        await vi.waitFor(() => {
            expect(el.micMeterActive).toBe(true)
        })

        osc.stop()
        await testCtx.close()
        await el.stopMicLevelMeter()
        getUserMediaSpy.mockRestore()
    })

    test('stops mic level meter when tabActive becomes false via property or setTabActive', async () => {
        const screen = render(html`<mic-settings .gain=${1}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        await elementUpdated(el)

        const stopSpy = vi.spyOn(el, 'stopMicLevelMeter')
        el.setTabActive(false)

        expect(stopSpy).toHaveBeenCalled()
    })

    test('stops mic level meter on visibilitychange when document is hidden', async () => {
        const screen = render(html`<mic-settings .gain=${1}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        await elementUpdated(el)

        const stopSpy = vi.spyOn(el, 'stopMicLevelMeter')

        const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
        document.dispatchEvent(new Event('visibilitychange'))

        expect(stopSpy).toHaveBeenCalled()
        hiddenSpy.mockRestore()
    })

    test('stops mic level meter on disconnectedCallback', async () => {
        const screen = render(html`<mic-settings .gain=${1}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        await elementUpdated(el)

        const stopSpy = vi.spyOn(el, 'stopMicLevelMeter')
        el.disconnectedCallback()

        expect(stopSpy).toHaveBeenCalled()
    })

    test('renders noiseSuppression, echoCancellation and autoGainControl switches and hints', async () => {
        const screen = render(html`<mic-settings .gain=${1}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        await elementUpdated(el)

        const switches = el.shadowRoot?.querySelectorAll('md-switch')
        expect(switches?.length).toBe(3)

        const hints = el.shadowRoot?.querySelectorAll('.mic-hint')
        expect(hints?.length).toBe(3)
    })

    test('disables gain slider when autoGainControl is true', async () => {
        const screen = render(html`<mic-settings .gain=${1} .autoGainControl=${true}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        await elementUpdated(el)

        const slider = shadowQuery(el, '#mic-gain') as any
        expect(slider.disabled).toBe(true)
    })

    test('dispatches noise-suppression-change event on switch input', async () => {
        const screen = render(html`<mic-settings .gain=${1} .noiseSuppression=${true}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        await elementUpdated(el)

        const startMeterSpy = vi.spyOn(el, 'startMicLevelMeter').mockResolvedValue()
        const nsChangeSpy = vi.fn()
        el.addEventListener('noise-suppression-change', nsChangeSpy)

        const switches = el.shadowRoot?.querySelectorAll('md-switch')
        const nsSwitch = switches?.[0] as any
        expect(nsSwitch).toBeDefined()
        nsSwitch.selected = false
        nsSwitch.dispatchEvent(new Event('input'))

        expect(nsChangeSpy).toHaveBeenCalled()
        const customEvent = nsChangeSpy.mock.calls[0][0] as CustomEvent
        expect(customEvent.detail.noiseSuppression).toBe(false)
        expect(startMeterSpy).toHaveBeenCalled()
    })

    test('dispatches echo-cancellation-change event on switch input', async () => {
        const screen = render(html`<mic-settings .gain=${1} .echoCancellation=${true}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        await elementUpdated(el)

        const startMeterSpy = vi.spyOn(el, 'startMicLevelMeter').mockResolvedValue()
        const echoChangeSpy = vi.fn()
        el.addEventListener('echo-cancellation-change', echoChangeSpy)

        const switches = el.shadowRoot?.querySelectorAll('md-switch')
        const echoSwitch = switches?.[1] as any
        expect(echoSwitch).toBeDefined()
        echoSwitch.selected = false
        echoSwitch.dispatchEvent(new Event('input'))

        expect(echoChangeSpy).toHaveBeenCalled()
        const customEvent = echoChangeSpy.mock.calls[0][0] as CustomEvent
        expect(customEvent.detail.echoCancellation).toBe(false)
        expect(startMeterSpy).toHaveBeenCalled()
    })

    test('dispatches auto-gain-control-change event on switch input', async () => {
        const screen = render(html`<mic-settings .gain=${1} .autoGainControl=${false}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        await elementUpdated(el)

        const startMeterSpy = vi.spyOn(el, 'startMicLevelMeter').mockResolvedValue()
        const agcChangeSpy = vi.fn()
        el.addEventListener('auto-gain-control-change', agcChangeSpy)

        const switches = el.shadowRoot?.querySelectorAll('md-switch')
        const agcSwitch = switches?.[2] as any
        expect(agcSwitch).toBeDefined()
        agcSwitch.selected = true
        agcSwitch.dispatchEvent(new Event('input'))

        expect(agcChangeSpy).toHaveBeenCalled()
        const customEvent = agcChangeSpy.mock.calls[0][0] as CustomEvent
        expect(customEvent.detail.autoGainControl).toBe(true)
        expect(startMeterSpy).toHaveBeenCalled()
    })

    test('passes noiseSuppression, echoCancellation and autoGainControl to getUserMedia constraints', async () => {
        const testCtx = new AudioContext()
        const osc = testCtx.createOscillator()
        const dst = testCtx.createMediaStreamDestination()
        osc.connect(dst)
        osc.start()

        const getUserMediaSpy = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(dst.stream)

        const screen = render(
            html`<mic-settings
                .gain=${1}
                .noiseSuppression=${false}
                .echoCancellation=${false}
                .autoGainControl=${true}></mic-settings>`,
        )
        const el = screen.container.querySelector('mic-settings') as MicSettings
        await elementUpdated(el)

        await el.startMicLevelMeter()

        expect(getUserMediaSpy).toHaveBeenCalledWith({
            audio: {
                channelCount: { ideal: 2 },
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: true,
            },
        })

        osc.stop()
        await testCtx.close()
        await el.stopMicLevelMeter()
        getUserMediaSpy.mockRestore()
    })

    test('activates mic level meter even if slider input occurs multiple times before meter becomes active', async () => {
        const testCtx = new AudioContext()
        const osc = testCtx.createOscillator()
        const dst = testCtx.createMediaStreamDestination()
        osc.connect(dst)
        osc.start()

        let resolveGetUserMedia: (stream: MediaStream) => void
        const getUserMediaPromise = new Promise<MediaStream>(resolve => {
            resolveGetUserMedia = resolve
        })
        const getUserMediaSpy = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockReturnValue(getUserMediaPromise)

        const screen = render(html`<mic-settings .gain=${1}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        await elementUpdated(el)

        expect(el.micMeterActive).toBe(false)

        const slider = shadowQuery(el, '#mic-gain') as any
        // First input: triggers startMicLevelMeter()
        slider.value = 1.2
        slider.dispatchEvent(new Event('input'))

        // Subsequent inputs while getUserMedia is still pending
        slider.value = 1.5
        slider.dispatchEvent(new Event('input'))
        slider.value = 2.0
        slider.dispatchEvent(new Event('input'))

        // Only 1 getUserMedia call should have been initiated
        await vi.waitFor(() => {
            expect(getUserMediaSpy).toHaveBeenCalledTimes(1)
        })

        // Now resolve getUserMedia
        resolveGetUserMedia!(dst.stream)

        await vi.waitFor(() => {
            expect(el.micMeterActive).toBe(true)
        })

        osc.stop()
        await testCtx.close()
        await el.stopMicLevelMeter()
        getUserMediaSpy.mockRestore()
    })

    test('activates mic level meter on noise-suppression switch input when initially inactive', async () => {
        const testCtx = new AudioContext()
        const osc = testCtx.createOscillator()
        const dst = testCtx.createMediaStreamDestination()
        osc.connect(dst)
        osc.start()

        const getUserMediaSpy = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(dst.stream)

        const screen = render(html`<mic-settings .gain=${1} .noiseSuppression=${true}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        await elementUpdated(el)

        expect(el.micMeterActive).toBe(false)

        const switches = el.shadowRoot?.querySelectorAll('md-switch')
        const nsSwitch = switches?.[0] as any
        nsSwitch.selected = false
        nsSwitch.dispatchEvent(new Event('input'))

        await vi.waitFor(() => {
            expect(el.micMeterActive).toBe(true)
        })

        osc.stop()
        await testCtx.close()
        await el.stopMicLevelMeter()
        getUserMediaSpy.mockRestore()
    })

    test('activates mic level meter on echo-cancellation switch input when initially inactive', async () => {
        const testCtx = new AudioContext()
        const osc = testCtx.createOscillator()
        const dst = testCtx.createMediaStreamDestination()
        osc.connect(dst)
        osc.start()

        const getUserMediaSpy = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(dst.stream)

        const screen = render(html`<mic-settings .gain=${1} .echoCancellation=${true}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        await elementUpdated(el)

        expect(el.micMeterActive).toBe(false)

        const switches = el.shadowRoot?.querySelectorAll('md-switch')
        const echoSwitch = switches?.[1] as any
        echoSwitch.selected = false
        echoSwitch.dispatchEvent(new Event('input'))

        await vi.waitFor(() => {
            expect(el.micMeterActive).toBe(true)
        })

        osc.stop()
        await testCtx.close()
        await el.stopMicLevelMeter()
        getUserMediaSpy.mockRestore()
    })

    test('activates mic level meter on auto-gain-control switch input when initially inactive', async () => {
        const testCtx = new AudioContext()
        const osc = testCtx.createOscillator()
        const dst = testCtx.createMediaStreamDestination()
        osc.connect(dst)
        osc.start()

        const getUserMediaSpy = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(dst.stream)

        const screen = render(html`<mic-settings .gain=${1} .autoGainControl=${false}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        await elementUpdated(el)

        expect(el.micMeterActive).toBe(false)

        const switches = el.shadowRoot?.querySelectorAll('md-switch')
        const agcSwitch = switches?.[2] as any
        agcSwitch.selected = true
        agcSwitch.dispatchEvent(new Event('input'))

        await vi.waitFor(() => {
            expect(el.micMeterActive).toBe(true)
        })

        osc.stop()
        await testCtx.close()
        await el.stopMicLevelMeter()
        getUserMediaSpy.mockRestore()
    })

    test('renders status and device select above mic-section-layout, and noise-suppression first in mic-controls', async () => {
        const screen = render(html`<mic-settings .gain=${1}></mic-settings>`)
        const el = screen.container.querySelector('mic-settings') as MicSettings
        el.availableMicrophones = [{ deviceId: 'mic-1', label: 'USB Mic' }] as MediaDeviceInfo[]
        await elementUpdated(el)

        const status = shadowQuery(el, '.mic-status')
        const deviceSelect = shadowQuery(el, '#mic-device')
        const layout = shadowQuery(el, '.mic-section-layout')
        const controls = shadowQuery(el, '.mic-controls')

        expect(status).not.toBeNull()
        expect(deviceSelect).not.toBeNull()
        expect(layout).not.toBeNull()
        expect(controls).not.toBeNull()

        // status and deviceSelect are outside layout
        expect(layout?.contains(status!)).toBe(false)
        expect(layout?.contains(deviceSelect!)).toBe(false)

        // First child in mic-controls is the noise suppression label
        const firstControl = controls?.firstElementChild
        expect(firstControl?.classList.contains('switch-label')).toBe(true)
    })

    test('does not attach permission change listener if disconnected while permissions.query is pending', async () => {
        let resolveQuery!: (val: any) => void
        const queryPromise = new Promise(resolve => {
            resolveQuery = resolve
        })

        const mockPermissionStatus = {
            state: 'granted',
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }

        const querySpy = vi.spyOn(navigator.permissions, 'query').mockReturnValue(queryPromise as any)

        const el = document.createElement('mic-settings') as MicSettings
        document.body.appendChild(el)

        // Disconnect element before permissions.query resolves
        el.remove()

        // Now resolve permissions.query
        resolveQuery(mockPermissionStatus)
        await Promise.resolve()
        await Promise.resolve()

        expect(mockPermissionStatus.addEventListener).not.toHaveBeenCalled()
        querySpy.mockRestore()
    })

    test('removes permission change listener on disconnect when already connected', async () => {
        const mockPermissionStatus = {
            state: 'granted',
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }

        const querySpy = vi.spyOn(navigator.permissions, 'query').mockResolvedValue(mockPermissionStatus as any)

        const el = document.createElement('mic-settings') as MicSettings
        document.body.appendChild(el)

        await vi.waitFor(() => {
            expect(mockPermissionStatus.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
        })

        el.remove()

        expect(mockPermissionStatus.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
        querySpy.mockRestore()
    })
})
