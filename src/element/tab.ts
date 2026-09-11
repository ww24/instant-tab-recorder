import { html, LitElement } from 'lit'
import { customElement } from 'lit/decorators.js'
import '@material/web/tabs/tabs'
import '@material/web/tabs/primary-tab'
import { MdTabs } from '@material/web/tabs/tabs'
import { Tab } from '@material/web/tabs/internal/tab'
import '@material/web/icon/icon'
import type { Cropping } from './cropping'
import { t } from '../i18n'

interface TabDefinition {
    id: string
    panelId: string
    hash: string
}

const TAB_DEFINITIONS: readonly TabDefinition[] = [
    { id: 'tab-main', panelId: 'panel-main', hash: '' },
    { id: 'tab-settings', panelId: 'panel-settings', hash: '#settings' },
    { id: 'tab-cropping', panelId: 'panel-cropping', hash: '#cropping' },
    { id: 'tab-support', panelId: 'panel-support', hash: '#support' },
] as const

function getTabByHash(hash: string): TabDefinition {
    const cleanHash = hash.startsWith('#') ? hash : hash ? `#${hash}` : ''
    return (
        TAB_DEFINITIONS.find(tab => tab.hash !== '' && tab.hash.toLowerCase() === cleanHash.toLowerCase()) ??
        TAB_DEFINITIONS[0]
    )
}

function updateHash(hash: string, replace?: boolean) {
    if (replace) {
        history.replaceState(null, '', window.location.pathname + window.location.search)
        return
    }
    if (hash) {
        if (window.location.hash !== hash) {
            history.pushState(null, '', hash)
        }
        return
    }
    if (window.location.hash) {
        history.pushState(null, '', window.location.pathname + window.location.search)
    }
}

@customElement('option-tab')
export class OptionTab extends LitElement {
    public constructor() {
        super()
    }

    public override connectedCallback() {
        super.connectedCallback()
        window.addEventListener('hashchange', this.handleHashChange)
    }

    public override disconnectedCallback() {
        super.disconnectedCallback()
        window.removeEventListener('hashchange', this.handleHashChange)
    }

    public override firstUpdated() {
        const currentHash = window.location.hash
        const activeTab = getTabByHash(currentHash)
        if (currentHash && activeTab.hash === '') {
            updateHash('', true)
        }
        if (activeTab.id === 'tab-cropping') {
            OptionTab.notifyCroppingTabState(true)
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
    }

    private changeTab = (e: Event) => {
        if (!(e.target instanceof MdTabs)) return
        const tabs = e.target

        this.syncTabPanels(tabs, tabs.activeTab)

        const activeTabId = tabs.activeTab?.id
        const tabDef = TAB_DEFINITIONS.find(item => item.id === activeTabId)
        if (tabDef) {
            updateHash(tabDef.hash)
        }
    }

    private handleHashChange = () => {
        const activeTabDef = getTabByHash(window.location.hash)
        if (window.location.hash && activeTabDef.hash === '') {
            updateHash('', true)
        }
        const tabs = this.shadowRoot?.querySelector<MdTabs>('md-tabs')
        if (!tabs) return

        const targetTab = tabs.tabs.find(tab => tab.id === activeTabDef.id)
        if (!targetTab) return

        if (tabs.activeTab !== targetTab) {
            tabs.activeTab = targetTab
        } else {
            this.syncTabPanels(tabs, targetTab)
        }
    }

    public override render() {
        const activeTab = getTabByHash(window.location.hash)

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
