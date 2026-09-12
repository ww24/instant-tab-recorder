import { html, LitElement } from 'lit'
import { customElement } from 'lit/decorators.js'
import '@material/web/tabs/tabs'
import '@material/web/tabs/primary-tab'
import { MdTabs } from '@material/web/tabs/tabs'
import { Tab } from '@material/web/tabs/internal/tab'
import '@material/web/icon/icon'
import type { Cropping } from './cropping'
import type { Settings } from './settings'
import { t } from '../i18n'

interface TabDefinition {
    id: string
    panelId: string
    param: string
}

const TAB_DEFINITIONS: readonly TabDefinition[] = [
    { id: 'tab-main', panelId: 'panel-main', param: '' },
    { id: 'tab-settings', panelId: 'panel-settings', param: 'settings' },
    { id: 'tab-cropping', panelId: 'panel-cropping', param: 'cropping' },
    { id: 'tab-support', panelId: 'panel-support', param: 'support' },
] as const

function getTabByParam(search: string): TabDefinition {
    const params = new URLSearchParams(search)
    const tabParam = params.get('tab')?.toLowerCase() ?? ''
    if (tabParam === 'records' || tabParam === '') {
        return TAB_DEFINITIONS[0]
    }
    return TAB_DEFINITIONS.find(tab => tab.param !== '' && tab.param.toLowerCase() === tabParam) ?? TAB_DEFINITIONS[0]
}

function updateTabQuery(param: string, options?: { replace?: boolean; clearHash?: boolean }) {
    const url = new URL(window.location.href)
    if (param) {
        url.searchParams.set('tab', param)
    } else {
        url.searchParams.delete('tab')
    }

    if (options?.clearHash) {
        url.hash = ''
    }

    const newSearch = url.searchParams.toString() ? `?${url.searchParams.toString()}` : ''
    const newHash = url.hash ? url.hash : ''
    const newUrl = `${url.pathname}${newSearch}${newHash}`

    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (newUrl === currentUrl) return

    if (options?.replace) {
        history.replaceState(null, '', newUrl)
    } else {
        history.pushState(null, '', newUrl)
    }
}

@customElement('option-tab')
export class OptionTab extends LitElement {
    public constructor() {
        super()
    }

    public override connectedCallback() {
        super.connectedCallback()
        window.addEventListener('popstate', this.handlePopState)
    }

    public override disconnectedCallback() {
        super.disconnectedCallback()
        window.removeEventListener('popstate', this.handlePopState)
    }

    public override firstUpdated() {
        const currentTabParam = new URLSearchParams(window.location.search).get('tab')
        const activeTab = getTabByParam(window.location.search)
        if (currentTabParam && activeTab.param === '' && currentTabParam !== 'records') {
            updateTabQuery('', { replace: true, clearHash: false })
        }
        if (activeTab.id === 'tab-cropping') {
            OptionTab.notifyCroppingTabState(true)
        }
        if (activeTab.id === 'tab-settings') {
            OptionTab.notifySettingsTabState(true)
        }
    }

    private static getPanel(tabs: MdTabs, tab: Tab): HTMLElement | null {
        const panelId = tab.getAttribute('aria-controls')
        const root = tabs.getRootNode() as Document | ShadowRoot
        return root.querySelector<HTMLElement>(`#${panelId}`)
    }

    private static async notifyCroppingTabState(isActive: boolean) {
        await customElements.whenDefined('extension-cropping')
        const croppingElement = document.querySelector<Cropping>('extension-cropping')
        if (croppingElement && typeof croppingElement.setTabActive === 'function') {
            croppingElement.setTabActive(isActive)
        }
    }

    private static async notifySettingsTabState(isActive: boolean) {
        await customElements.whenDefined('extension-settings')
        const settingsElement = document.querySelector<Settings>('extension-settings')
        if (settingsElement && typeof settingsElement.setTabActive === 'function') {
            settingsElement.setTabActive(isActive)
        }
    }

    private syncTabPanels(tabs: MdTabs, activeTab: Tab | null) {
        tabs.tabs.forEach(tab => {
            if (tab === activeTab) return
            const panel = OptionTab.getPanel(tabs, tab)
            if (panel && !panel.hidden) {
                panel.hidden = true
            }

            // Notify cropping tab when it becomes inactive
            if (tab.id === 'tab-cropping') {
                OptionTab.notifyCroppingTabState(false)
            }
            if (tab.id === 'tab-settings') {
                OptionTab.notifySettingsTabState(false)
            }
        })

        if (!activeTab) return
        const currentPanel = OptionTab.getPanel(tabs, activeTab)
        if (currentPanel) {
            currentPanel.hidden = false
        }

        // Notify cropping tab when it becomes active
        if (activeTab.id === 'tab-cropping') {
            OptionTab.notifyCroppingTabState(true)
        }
        if (activeTab.id === 'tab-settings') {
            OptionTab.notifySettingsTabState(true)
        }
    }

    private isPopStateNavigating = false

    private changeTab = (e: Event) => {
        if (this.isPopStateNavigating) return
        if (!(e.target instanceof MdTabs)) return
        const tabs = e.target

        this.syncTabPanels(tabs, tabs.activeTab)

        const activeTabId = tabs.activeTab?.id
        const tabDef = TAB_DEFINITIONS.find(item => item.id === activeTabId)
        if (tabDef) {
            updateTabQuery(tabDef.param, { clearHash: true })
        }
    }

    private handlePopState = () => {
        this.isPopStateNavigating = true
        try {
            const currentTabParam = new URLSearchParams(window.location.search).get('tab')
            const activeTabDef = getTabByParam(window.location.search)
            if (currentTabParam && activeTabDef.param === '' && currentTabParam !== 'records') {
                updateTabQuery('', { replace: true, clearHash: false })
            }
            const tabs = this.shadowRoot?.querySelector<MdTabs>('md-tabs')
            if (!tabs) return

            const targetTab = tabs.tabs.find(tab => tab.id === activeTabDef.id)
            if (!targetTab) return

            if (tabs.activeTab !== targetTab) {
                tabs.activeTab = targetTab
            }
            this.syncTabPanels(tabs, targetTab)
        } finally {
            queueMicrotask(() => {
                this.isPopStateNavigating = false
            })
        }
    }

    public override render() {
        const activeTab = getTabByParam(window.location.search)

        return html`
            <md-tabs @change=${this.changeTab}>
                <md-primary-tab
                    id="tab-main"
                    aria-controls="panel-main"
                    inline-icon
                    ?active=${activeTab.id === 'tab-main'}>
                    <md-icon slot="icon">video_library</md-icon>
                    ${t('tabRecords')}
                </md-primary-tab>
                <md-primary-tab
                    id="tab-settings"
                    aria-controls="panel-settings"
                    inline-icon
                    ?active=${activeTab.id === 'tab-settings'}>
                    <md-icon slot="icon">settings</md-icon>
                    ${t('tabSettings')}
                </md-primary-tab>
                <md-primary-tab
                    id="tab-cropping"
                    aria-controls="panel-cropping"
                    inline-icon
                    ?active=${activeTab.id === 'tab-cropping'}>
                    <md-icon slot="icon">crop</md-icon>
                    ${t('tabCropping')}
                </md-primary-tab>
                <md-primary-tab
                    id="tab-support"
                    aria-controls="panel-support"
                    inline-icon
                    ?active=${activeTab.id === 'tab-support'}>
                    <md-icon slot="icon">support</md-icon>
                    ${t('tabSupport')}
                </md-primary-tab>
            </md-tabs>
            <div role="tabpanel" id="panel-main" aria-labelledby="tab-main" ?hidden=${activeTab.id !== 'tab-main'}>
                <slot name="panel-main"></slot>
            </div>
            <div
                role="tabpanel"
                id="panel-settings"
                aria-labelledby="tab-settings"
                ?hidden=${activeTab.id !== 'tab-settings'}>
                <slot name="panel-settings"></slot>
            </div>
            <div
                role="tabpanel"
                id="panel-cropping"
                aria-labelledby="tab-cropping"
                ?hidden=${activeTab.id !== 'tab-cropping'}>
                <slot name="panel-cropping"></slot>
            </div>
            <div
                role="tabpanel"
                id="panel-support"
                aria-labelledby="tab-support"
                ?hidden=${activeTab.id !== 'tab-support'}>
                <slot name="panel-support"></slot>
            </div>
        `
    }
}
