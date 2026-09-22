import { html, css, LitElement, PropertyValues } from 'lit'
import { live } from 'lit/directives/live.js'
import { customElement, property } from 'lit/decorators.js'
import '@material/web/icon/icon'
import '@material/web/select/select-option'
import { MdFilledSelect } from '@material/web/select/filled-select'
import { MdSlider } from '@material/web/slider/slider'
import { MdSwitch } from '@material/web/switch/switch'
import { formatNum } from '../format'
import { t } from '../i18n'
import { switchLabelStyle } from './switchStyle'

function getRMS(buf: Float32Array): number {
    let sum = 0
    for (const s of buf) sum += s * s
    return Math.sqrt(sum / buf.length)
}

function toPercent(level: number): number {
    if (level <= 0) return 0
    const dBFS = 20 * Math.log10(level)
    const MIN_DB = -60
    return Math.min(1, Math.max(0, (dBFS - MIN_DB) / (0 - MIN_DB)))
}

function barHeight(level: number): string {
    return `${Math.round(toPercent(level) * 100)}%`
}

function peakTop(peak: number): string {
    const pct = toPercent(peak)
    return `${Math.round((1 - pct) * 100)}%`
}

@customElement('mic-settings')
export class MicSettings extends LitElement {
    public static override styles = [
        switchLabelStyle,
        css`
            :host {
                display: block;
            }
            .mic-hint {
                font-size: 0.8rem;
                color: var(--theme-text-secondary, #666);
                margin-top: -0.5rem;
                margin-bottom: 0.75rem;
                line-height: 1.4;
            }
            .mic-status {
                margin-bottom: 0.5rem;
                font-size: 0.9rem;
            }
            .mic-status.granted {
                color: var(--theme-success, #4caf50);
            }
            .mic-status.required {
                color: var(--theme-error, #f44336);
            }
            .field-label {
                font-size: 0.9rem;
                display: block;
                margin-bottom: 0.5rem;
            }
            .mic-device-select-container {
                margin-bottom: 0.75rem;
            }
            .mic-section-layout {
                display: flex;
                gap: 1.5rem;
                align-items: flex-start;
            }
            .mic-controls {
                flex: 1;
                min-width: 0;
            }
            .mic-controls > .switch-label:first-child {
                margin-top: 0;
            }
            .mic-level-meter-container {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 0.5rem;
                padding: 0.75rem;
                background: var(--theme-surface-variant, #f0f0f8);
                border-radius: 12px;
                border: 1px solid var(--theme-border, #e0e0e8);
                min-width: 80px;
                flex-shrink: 0;
                align-self: flex-end;
            }
            .mic-level-meter-label {
                font-size: 0.7rem;
                color: var(--theme-text-secondary, #666);
                text-transform: uppercase;
                letter-spacing: 0.05em;
                font-weight: 500;
                white-space: nowrap;
            }
            .mic-level-channels {
                display: flex;
                gap: 0.5rem;
                align-items: flex-end;
                justify-content: center;
            }
            .mic-level-channel {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 4px;
            }
            .mic-level-channel-label {
                font-size: 0.65rem;
                color: var(--theme-text-secondary, #666);
                font-weight: 600;
                letter-spacing: 0.03em;
            }
            .mic-level-bar-wrapper {
                width: 20px;
                height: 80px;
                background: var(--theme-input-bg, #e8e8f0);
                border-radius: 6px;
                overflow: hidden;
                position: relative;
                display: flex;
                flex-direction: column;
                justify-content: flex-end;
            }
            .mic-level-bar {
                width: 100%;
                background: linear-gradient(
                    to top,
                    var(--theme-success, #4caf50) 0%,
                    var(--theme-success, #4caf50) 60%,
                    var(--theme-warning, #f57c00) 60%,
                    var(--theme-warning, #f57c00) 85%,
                    var(--theme-error, #e53935) 85%,
                    var(--theme-error, #e53935) 100%
                );
                background-size: 100% 80px;
                background-position: bottom;
                border-radius: 4px;
                min-height: 2px;
            }
            .mic-level-peak {
                position: absolute;
                left: 2px;
                right: 2px;
                height: 2px;
                border-radius: 1px;
                background: var(--theme-accent, #4361ee);
            }
            .mic-level-inactive {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 98px;
                box-sizing: border-box;
                gap: 0.25rem;
                color: var(--theme-text-secondary, #999);
                font-size: 0.7rem;
                text-align: center;
                padding: 0.5rem 0;
            }
            .mic-level-inactive md-icon {
                font-size: 1.5rem;
                opacity: 0.4;
            }
        `,
    ]

    @property({ type: Number })
    public gain: number = 1

    @property({ type: String })
    public deviceId: string | null = null

    @property({ type: Boolean })
    public noiseSuppression: boolean = true

    @property({ type: Boolean })
    public echoCancellation: boolean = true

    @property({ type: Boolean })
    public autoGainControl: boolean = false

    @property({ type: Boolean, attribute: 'tab-active' })
    public tabActive: boolean = true

    @property({ type: Boolean })
    public microphonePermissionGranted: boolean = false

    @property({ type: Array })
    public availableMicrophones: MediaDeviceInfo[] = []

    @property({ type: Number })
    public micLevelL: number = 0

    @property({ type: Number })
    public micLevelR: number = 0

    @property({ type: Number })
    public micPeakL: number = 0

    @property({ type: Number })
    public micPeakR: number = 0

    @property({ type: Boolean })
    public micMeterActive: boolean = false

    private micAudioContext: AudioContext | null = null
    private micStream: MediaStream | null = null
    private micAnimationFrameId: number | null = null
    private micPeakDecayL: number = 0
    private micPeakDecayR: number = 0
    private micPeakHoldTimerL: ReturnType<typeof setTimeout> | null = null
    private micPeakHoldTimerR: ReturnType<typeof setTimeout> | null = null
    private micGainNode: GainNode | null = null
    private micMeterGeneration: number = 0
    private micMeterStarting: boolean = false
    private micMeterPendingRestart: boolean = false
    private connectionGeneration: number = 0
    private handleVisibilityChange?: () => void
    private handlePageHide?: () => void
    private handleDeviceChange?: () => void
    private permissionStatus?: PermissionStatus
    private handlePermissionChange?: () => void

    public override connectedCallback() {
        super.connectedCallback()
        const generation = ++this.connectionGeneration

        this.updateMicPermission(generation)

        this.handleVisibilityChange = () => {
            if (document.hidden) {
                this.stopMicLevelMeter()
            }
        }
        document.addEventListener('visibilitychange', this.handleVisibilityChange)

        this.handlePageHide = () => {
            this.stopMicLevelMeter()
        }
        window.addEventListener('pagehide', this.handlePageHide)

        this.handleDeviceChange = () => {
            this.enumerateMicrophones()
        }
        navigator.mediaDevices?.addEventListener('devicechange', this.handleDeviceChange)
    }

    public override disconnectedCallback() {
        super.disconnectedCallback()
        this.connectionGeneration++

        if (this.handleVisibilityChange) {
            document.removeEventListener('visibilitychange', this.handleVisibilityChange)
        }
        if (this.handlePageHide) {
            window.removeEventListener('pagehide', this.handlePageHide)
        }
        if (this.handleDeviceChange) {
            navigator.mediaDevices?.removeEventListener('devicechange', this.handleDeviceChange)
        }
        if (this.permissionStatus && this.handlePermissionChange) {
            this.permissionStatus.removeEventListener('change', this.handlePermissionChange)
            this.permissionStatus = undefined
            this.handlePermissionChange = undefined
        }
        this.stopMicLevelMeter()
    }

    protected override updated(changedProperties: PropertyValues<this>) {
        if (changedProperties.has('tabActive')) {
            if (!this.tabActive) {
                this.stopMicLevelMeter()
            }
        }
        if (changedProperties.has('gain') && changedProperties.get('gain') !== undefined) {
            if (this.micMeterActive && !this.autoGainControl) {
                this.updateMicLevelMeterGain(this.gain)
            }
        }
        if (changedProperties.has('deviceId') && changedProperties.get('deviceId') !== undefined) {
            if (this.micMeterActive) {
                this.startMicLevelMeter()
            }
        }
        if (
            (changedProperties.has('noiseSuppression') && changedProperties.get('noiseSuppression') !== undefined) ||
            (changedProperties.has('echoCancellation') && changedProperties.get('echoCancellation') !== undefined) ||
            (changedProperties.has('autoGainControl') && changedProperties.get('autoGainControl') !== undefined)
        ) {
            if (this.micMeterActive) {
                this.startMicLevelMeter()
            }
        }
    }

    public setTabActive(isActive: boolean) {
        this.tabActive = isActive
        if (!isActive) {
            this.stopMicLevelMeter()
        }
    }

    private async updateMicPermission(generation: number) {
        try {
            const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName })
            if (!this.isConnected || generation !== this.connectionGeneration) {
                return
            }
            this.permissionStatus = permission
            this.handlePermissionChange = async () => {
                if (!this.isConnected || generation !== this.connectionGeneration) {
                    return
                }
                if (this.permissionStatus?.state !== 'granted') {
                    this.microphonePermissionGranted = false
                    return
                }
                this.microphonePermissionGranted = true
                await this.enumerateMicrophones()
            }
            permission.addEventListener('change', this.handlePermissionChange)
            await this.handlePermissionChange()
        } catch {
            if (!this.isConnected || generation !== this.connectionGeneration) {
                return
            }
            await this.enumerateMicrophones()
        }
    }

    private async enumerateMicrophones() {
        if (!this.isConnected) {
            return
        }
        try {
            const devices = await navigator.mediaDevices.enumerateDevices()
            if (!this.isConnected) {
                return
            }
            this.availableMicrophones = devices.filter(device => device.kind === 'audioinput')
            if (this.availableMicrophones.length > 0 && this.availableMicrophones.some(d => d.label)) {
                this.microphonePermissionGranted = true
            }
        } catch (e) {
            console.warn('Cannot enumerate microphones:', e)
            this.availableMicrophones = []
        }
    }

    public async startMicLevelMeter() {
        if (!this.tabActive || document.hidden) {
            return
        }

        if (this.micMeterStarting) {
            this.micMeterPendingRestart = true
            return
        }

        this.micMeterStarting = true
        try {
            await this.stopMicLevelMeter()
            const generation = ++this.micMeterGeneration

            if (generation !== this.micMeterGeneration || !this.tabActive || document.hidden) {
                return
            }

            let stream: MediaStream
            try {
                const constraints: MediaStreamConstraints = {
                    audio: {
                        ...(this.deviceId ? { deviceId: { exact: this.deviceId } } : {}),
                        channelCount: { ideal: 2 },
                        echoCancellation: this.echoCancellation,
                        noiseSuppression: this.noiseSuppression,
                        autoGainControl: this.autoGainControl,
                    },
                }
                stream = await navigator.mediaDevices.getUserMedia(constraints)
            } catch {
                if (generation !== this.micMeterGeneration || !this.tabActive || document.hidden) {
                    return
                }
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        ...(this.deviceId ? { deviceId: { exact: this.deviceId } } : {}),
                        echoCancellation: this.echoCancellation,
                        noiseSuppression: this.noiseSuppression,
                        autoGainControl: this.autoGainControl,
                    },
                })
            }

            if (generation !== this.micMeterGeneration || !this.tabActive || document.hidden) {
                stream.getTracks().forEach(track => track.stop())
                return
            }

            this.micStream = stream

            const ctx = new AudioContext()
            if (ctx.state === 'suspended') {
                void ctx.resume().catch(() => {})
            }
            this.micAudioContext = ctx

            const source = ctx.createMediaStreamSource(stream)

            const gainNode = ctx.createGain()
            gainNode.channelCount = 2
            gainNode.channelCountMode = 'explicit'
            gainNode.channelInterpretation = 'speakers'
            gainNode.gain.value = this.autoGainControl ? 1.0 : this.gain
            this.micGainNode = gainNode
            source.connect(gainNode)

            const splitter = ctx.createChannelSplitter(2)
            gainNode.connect(splitter)

            const analyserL = ctx.createAnalyser()
            analyserL.fftSize = 2048
            analyserL.smoothingTimeConstant = 0.6
            splitter.connect(analyserL, 0)

            const analyserR = ctx.createAnalyser()
            analyserR.fftSize = 2048
            analyserR.smoothingTimeConstant = 0.6
            splitter.connect(analyserR, 1)

            const bufL = new Float32Array(analyserL.fftSize)
            const bufR = new Float32Array(analyserR.fftSize)

            const PEAK_HOLD_MS = 1500
            const PEAK_DECAY_RATE = 0.015
            const BAR_DECAY_FACTOR = 0.88

            this.micMeterActive = true

            const tick = () => {
                if (!this.micMeterActive || generation !== this.micMeterGeneration) return

                analyserL.getFloatTimeDomainData(bufL)
                analyserR.getFloatTimeDomainData(bufR)

                const rmsL = getRMS(bufL)
                const rmsR = getRMS(bufR)

                // Bar: Instant attack, smooth exponential decay
                if (rmsL >= this.micLevelL) {
                    this.micLevelL = rmsL
                } else {
                    this.micLevelL = Math.max(rmsL, this.micLevelL * BAR_DECAY_FACTOR)
                }

                if (rmsR >= this.micLevelR) {
                    this.micLevelR = rmsR
                } else {
                    this.micLevelR = Math.max(rmsR, this.micLevelR * BAR_DECAY_FACTOR)
                }

                // Peak: Instant attack, hold for PEAK_HOLD_MS, then linear decay
                if (rmsL >= this.micPeakL) {
                    this.micPeakL = rmsL
                    this.micPeakDecayL = rmsL
                    if (this.micPeakHoldTimerL) clearTimeout(this.micPeakHoldTimerL)
                    this.micPeakHoldTimerL = setTimeout(() => {
                        this.micPeakHoldTimerL = null
                    }, PEAK_HOLD_MS)
                } else if (!this.micPeakHoldTimerL) {
                    this.micPeakDecayL = Math.max(this.micLevelL, this.micPeakDecayL - PEAK_DECAY_RATE)
                    this.micPeakL = this.micPeakDecayL
                }

                if (rmsR >= this.micPeakR) {
                    this.micPeakR = rmsR
                    this.micPeakDecayR = rmsR
                    if (this.micPeakHoldTimerR) clearTimeout(this.micPeakHoldTimerR)
                    this.micPeakHoldTimerR = setTimeout(() => {
                        this.micPeakHoldTimerR = null
                    }, PEAK_HOLD_MS)
                } else if (!this.micPeakHoldTimerR) {
                    this.micPeakDecayR = Math.max(this.micLevelR, this.micPeakDecayR - PEAK_DECAY_RATE)
                    this.micPeakR = this.micPeakDecayR
                }

                this.micAnimationFrameId = requestAnimationFrame(tick)
            }
            this.micAnimationFrameId = requestAnimationFrame(tick)
        } catch (e) {
            await this.stopMicLevelMeter()
            console.warn('Failed to start mic level meter:', e)
            this.micMeterActive = false
        } finally {
            this.micMeterStarting = false
            if (this.micMeterPendingRestart) {
                this.micMeterPendingRestart = false
                void this.startMicLevelMeter()
            }
        }
    }

    public async stopMicLevelMeter() {
        this.micMeterGeneration++
        this.micMeterPendingRestart = false
        this.micMeterActive = false
        this.micLevelL = 0
        this.micLevelR = 0
        this.micPeakL = 0
        this.micPeakR = 0
        this.micPeakDecayL = 0
        this.micPeakDecayR = 0

        if (this.micAnimationFrameId != null) {
            cancelAnimationFrame(this.micAnimationFrameId)
            this.micAnimationFrameId = null
        }
        if (this.micPeakHoldTimerL != null) {
            clearTimeout(this.micPeakHoldTimerL)
            this.micPeakHoldTimerL = null
        }
        if (this.micPeakHoldTimerR != null) {
            clearTimeout(this.micPeakHoldTimerR)
            this.micPeakHoldTimerR = null
        }
        this.micGainNode = null
        if (this.micStream) {
            this.micStream.getTracks().forEach(track => track.stop())
            this.micStream = null
        }
        if (this.micAudioContext) {
            try {
                await this.micAudioContext.close()
            } catch {
                // ignore
            }
            this.micAudioContext = null
        }
        this.requestUpdate()
    }

    private updateMicLevelMeterGain(gain: number) {
        if (this.micGainNode) {
            this.micGainNode.gain.value = this.autoGainControl ? 1.0 : gain
        }
    }

    private handleNoiseSuppressionInput(e: Event) {
        if (!(e.target instanceof MdSwitch)) return
        const newNoiseSuppression = e.target.selected
        this.noiseSuppression = newNoiseSuppression
        void this.startMicLevelMeter()
        this.dispatchEvent(
            new CustomEvent('noise-suppression-change', {
                detail: { noiseSuppression: newNoiseSuppression },
                bubbles: true,
                composed: true,
            }),
        )
    }

    private handleEchoCancellationInput(e: Event) {
        if (!(e.target instanceof MdSwitch)) return
        const newEchoCancellation = e.target.selected
        this.echoCancellation = newEchoCancellation
        void this.startMicLevelMeter()
        this.dispatchEvent(
            new CustomEvent('echo-cancellation-change', {
                detail: { echoCancellation: newEchoCancellation },
                bubbles: true,
                composed: true,
            }),
        )
    }

    private handleAutoGainControlInput(e: Event) {
        if (!(e.target instanceof MdSwitch)) return
        const newAutoGainControl = e.target.selected
        this.autoGainControl = newAutoGainControl
        void this.startMicLevelMeter()
        this.dispatchEvent(
            new CustomEvent('auto-gain-control-change', {
                detail: { autoGainControl: newAutoGainControl },
                bubbles: true,
                composed: true,
            }),
        )
    }

    private handleGainInput(e: Event) {
        if (!(e.target instanceof MdSlider)) return
        const newGain = e.target.value ?? 0
        this.gain = newGain
        if (this.micMeterActive) {
            this.updateMicLevelMeterGain(newGain)
        } else if (!this.micMeterStarting) {
            void this.startMicLevelMeter()
        }
        this.dispatchEvent(
            new CustomEvent('gain-change', {
                detail: { gain: newGain },
                bubbles: true,
                composed: true,
            }),
        )
    }

    private handleDeviceInput(e: Event) {
        if (!(e.target instanceof MdFilledSelect)) return
        const newDevice = e.target.value === 'default' ? null : e.target.value
        this.deviceId = newDevice
        void this.startMicLevelMeter()
        this.dispatchEvent(
            new CustomEvent('device-change', {
                detail: { deviceId: newDevice },
                bubbles: true,
                composed: true,
            }),
        )
    }

    private renderMicLevelMeter() {
        if (!this.micMeterActive) {
            return html`
                <div class="mic-level-meter-container">
                    <span class="mic-level-meter-label">${t('settingsMicInputLevel')}</span>
                    <div class="mic-level-inactive">
                        <md-icon>mic_off</md-icon>
                    </div>
                </div>
            `
        }

        return html`
            <div class="mic-level-meter-container">
                <span class="mic-level-meter-label">${t('settingsMicInputLevel')}</span>
                <div class="mic-level-channels">
                    <div class="mic-level-channel">
                        <div class="mic-level-bar-wrapper">
                            <div class="mic-level-bar" style="height: ${barHeight(this.micLevelL)}"></div>
                            <div class="mic-level-peak" style="top: ${peakTop(this.micPeakL)}"></div>
                        </div>
                        <span class="mic-level-channel-label">L</span>
                    </div>
                    <div class="mic-level-channel">
                        <div class="mic-level-bar-wrapper">
                            <div class="mic-level-bar" style="height: ${barHeight(this.micLevelR)}"></div>
                            <div class="mic-level-peak" style="top: ${peakTop(this.micPeakR)}"></div>
                        </div>
                        <span class="mic-level-channel-label">R</span>
                    </div>
                </div>
            </div>
        `
    }

    public override render() {
        return html`
            <div class="mic-status ${this.microphonePermissionGranted ? 'granted' : 'required'}">
                ${t(
                    'settingsMicStatus',
                    this.microphonePermissionGranted ? t('settingsPermissionGranted') : t('settingsPermissionRequired'),
                )}
            </div>
            ${
                this.availableMicrophones.length > 0
                    ? html`
                          <div class="mic-device-select-container">
                              <label for="mic-device" class="field-label">${t('settingsMicDevice')}</label>
                              <md-filled-select
                                  id="mic-device"
                                  .value=${this.deviceId ?? 'default'}
                                  @input=${this.handleDeviceInput}>
                                  <md-select-option value="default">
                                      <div slot="headline">${t('settingsDefaultDevice')}</div>
                                  </md-select-option>
                                  ${this.availableMicrophones.map(
                                      device => html`
                                          <md-select-option value=${device.deviceId}>
                                              <div slot="headline">
                                                  ${device.label ?? `Microphone ${device.deviceId.slice(0, 8)}...`}
                                              </div>
                                          </md-select-option>
                                      `,
                                  )}
                              </md-filled-select>
                          </div>
                      `
                    : ''
            }
            <div class="mic-section-layout">
                <div class="mic-controls">
                    <label class="switch-label">
                        ${t('settingsMicNoiseSuppression')}
                        <md-switch
                            ?selected=${live(this.noiseSuppression)}
                            @input=${this.handleNoiseSuppressionInput}></md-switch>
                    </label>
                    <p class="mic-hint">${t('settingsMicNoiseSuppressionHint')}</p>

                    <label class="switch-label">
                        ${t('settingsMicEchoCancellation')}
                        <md-switch
                            ?selected=${live(this.echoCancellation)}
                            @input=${this.handleEchoCancellationInput}></md-switch>
                    </label>
                    <p class="mic-hint">${t('settingsMicEchoCancellationHint')}</p>

                    <label class="switch-label">
                        ${t('settingsMicAutoGainControl')}
                        <md-switch
                            ?selected=${live(this.autoGainControl)}
                            @input=${this.handleAutoGainControlInput}></md-switch>
                    </label>
                    <p class="mic-hint">${t('settingsMicAutoGainControlHint')}</p>

                    <div>
                        <label for="mic-gain" class="field-label">
                            ${t('settingsMicVolume', formatNum(this.gain, 1))}
                        </label>
                        <md-slider
                            id="mic-gain"
                            min="0"
                            max="10"
                            step="0.1"
                            ?disabled=${live(this.autoGainControl)}
                            .value=${live(this.gain)}
                            @input=${this.handleGainInput}></md-slider>
                    </div>
                </div>
                ${this.renderMicLevelMeter()}
            </div>
        `
    }
}
