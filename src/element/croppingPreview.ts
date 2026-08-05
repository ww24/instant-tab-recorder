import { html, css, LitElement, PropertyValues } from 'lit'
import { customElement, property, state, query } from 'lit/decorators.js'
import { CropRegion } from '../configuration'
import type { PreviewFrameMessage } from '../message'
import { roundToEven, clampCoordinate, clampDimension } from './util'
import { t } from '../i18n'

export interface CropRegionChangeEvent {
    region: CropRegion
}

@customElement('cropping-preview')
export class CroppingPreview extends LitElement {
    static override readonly styles = css`
        :host {
            display: block;
        }
        .preview-container {
            position: relative;
            background: var(--theme-preview-bg, #1a1a1a);
            border-radius: 8px;
            overflow: hidden;
            min-height: 200px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .preview-message {
            position: absolute;
            top: 50%;
            left: 0;
            transform: translate(0, -100%);
            width: 100%;
            color: var(--theme-preview-message, #999);
            font-style: italic;
            pointer-events: none;
            text-align: center;
        }
        .preview-canvas.hidden {
            display: none;
        }
        .preview-wrapper {
            position: relative;
            width: 100%;
        }
        .preview-canvas {
            display: block;
            max-width: 100%;
            height: auto;
        }
        .screen-overlay {
            position: absolute;
            top: 0;
            left: 0;
            pointer-events: none;
        }
        .crop-overlay {
            position: absolute;
            border: 2px solid var(--theme-crop-border, #2196f3);
            background: var(--theme-crop-bg, rgba(33, 150, 243, 0.1));
            box-sizing: border-box;
            cursor: move;
        }
        .crop-overlay.disabled {
            cursor: default;
            border-color: var(--theme-crop-disabled, #666);
            background: rgba(102, 102, 102, 0.1);
        }
        .resize-handle {
            position: absolute;
            width: 12px;
            height: 12px;
            background: var(--theme-crop-handle, #2196f3);
            border: 2px solid var(--theme-crop-handle-border, #fff);
            border-radius: 2px;
            box-sizing: border-box;
        }
        .resize-handle.disabled {
            background: var(--theme-crop-disabled, #666);
        }
        .resize-handle.nw {
            top: -6px;
            left: -6px;
            cursor: nw-resize;
        }
        .resize-handle.ne {
            top: -6px;
            right: -6px;
            cursor: ne-resize;
        }
        .resize-handle.sw {
            bottom: -6px;
            left: -6px;
            cursor: sw-resize;
        }
        .resize-handle.se {
            bottom: -6px;
            right: -6px;
            cursor: se-resize;
        }
        .resize-handle.disabled {
            cursor: default;
        }
        .dim-overlay {
            position: absolute;
            background: var(--theme-overlay-dim, rgba(0, 0, 0, 0.5));
            pointer-events: none;
        }
    `

    @property({ type: Boolean })
    croppingEnabled: boolean = false

    @property({ type: Object })
    cropRegion: CropRegion = { x: 0, y: 0, width: 1920, height: 1080 }

    @property({ type: Boolean })
    isRecording: boolean = false

    @property({ type: Boolean })
    canInteract: boolean = true

    @query('.preview-canvas', true)
    private canvas!: HTMLCanvasElement

    private canvasCtx?: ImageBitmapRenderingContext

    @state()
    private hasPreview: boolean = false

    @state()
    private recordingWidth: number = 0 // Recording resolution width

    @state()
    private recordingHeight: number = 0 // Recording resolution height

    @state()
    private displayWidth: number = 0 // Actual display width

    @state()
    private displayHeight: number = 0 // Actual display height

    @state()
    private isDragging: boolean = false

    @state()
    private isResizing: boolean = false

    @state()
    private resizeDirection: string = ''

    private dragStartX: number = 0
    private dragStartY: number = 0
    private initialCropRegion: CropRegion = { x: 0, y: 0, width: 0, height: 0 }

    override connectedCallback() {
        super.connectedCallback()
        // Listen for preview frame messages
        chrome.runtime.onMessage.addListener(this.handleMessage)
    }

    override disconnectedCallback() {
        super.disconnectedCallback()
        chrome.runtime.onMessage.removeListener(this.handleMessage)
    }

    protected override firstUpdated(): void {
        // Cache canvas context after first render
        const ctx = this.canvas.getContext('bitmaprenderer')
        if (ctx) {
            this.canvasCtx = ctx
        } else {
            console.error('failed to get canvas context')
        }
    }

    protected override willUpdate(changedProperties: PropertyValues<this>): void {
        // Clear preview when recording stops
        if (changedProperties.has('isRecording') && !this.isRecording) {
            this.hasPreview = false
        }
    }

    // NOTE: Must not return true or a truthy value (e.g. Promise from async function)
    // to avoid interfering with sendMessage responses from other contexts.
    private handleMessage = (message: PreviewFrameMessage) => {
        if (message.type !== 'preview-frame' || !message.image) return
        ;(async () => {
            this.recordingWidth = message.recordingSize.width
            this.recordingHeight = message.recordingSize.height

            // Set canvas internal resolution to match recording size
            if (this.canvas.width !== this.recordingWidth || this.canvas.height !== this.recordingHeight) {
                this.canvas.width = this.recordingWidth
                this.canvas.height = this.recordingHeight
            }

            // Use bitmaprenderer for zero-copy transfer (more efficient than 2d context)
            if (this.canvasCtx) {
                const blob = new Blob([Uint8Array.fromBase64(message.image)], { type: 'image/jpeg' })
                const bitmap = await createImageBitmap(blob)
                // Note: bitmap is consumed by transferFromImageBitmap, no need to close
                this.canvasCtx.transferFromImageBitmap(bitmap)
            }

            // Update display dimensions based on rendered size
            this.displayWidth = this.canvas.clientWidth
            this.displayHeight = this.canvas.clientHeight

            if (!this.hasPreview) {
                this.hasPreview = true
            }
        })().catch((error: unknown) => {
            console.error('Failed to process preview frame', error)
        })
    }

    // Calculate scale factor for preview display
    // Scale from recording resolution to actual display size
    private get scale(): number {
        if (this.recordingWidth === 0 || this.displayWidth === 0) return 1
        return this.displayWidth / this.recordingWidth
    }

    // Convert screen coordinates to preview coordinates
    private toPreviewCoords(value: number): number {
        return value * this.scale
    }

    // Convert preview coordinates to screen coordinates
    private toScreenCoords(value: number): number {
        return Math.round(value / this.scale)
    }

    private handleCropPointerDown = (e: PointerEvent) => {
        if (!this.canInteract || !this.croppingEnabled) return
        e.preventDefault()
        this.isDragging = true
        this.dragStartX = e.clientX
        this.dragStartY = e.clientY
        this.initialCropRegion = { ...this.cropRegion }

        const target = e.target as HTMLElement
        target.setPointerCapture(e.pointerId)
    }

    private handleResizePointerDown = (e: PointerEvent, direction: string) => {
        if (!this.canInteract || !this.croppingEnabled) return
        e.preventDefault()
        e.stopPropagation()
        this.isResizing = true
        this.resizeDirection = direction
        this.dragStartX = e.clientX
        this.dragStartY = e.clientY
        this.initialCropRegion = { ...this.cropRegion }

        const target = e.target as HTMLElement
        target.setPointerCapture(e.pointerId)
    }

    private handlePointerMove = (e: PointerEvent) => {
        if (!this.isDragging && !this.isResizing) return
        if (this.recordingWidth === 0) return

        const deltaX = this.toScreenCoords(e.clientX - this.dragStartX)
        const deltaY = this.toScreenCoords(e.clientY - this.dragStartY)

        let newRegion: CropRegion

        if (this.isDragging) {
            // Move the crop region
            // x, y: must be non-negative and even for VideoFrame
            const newX = clampCoordinate(
                Math.min(this.initialCropRegion.x + deltaX, this.recordingWidth - this.initialCropRegion.width),
            )
            const newY = clampCoordinate(
                Math.min(this.initialCropRegion.y + deltaY, this.recordingHeight - this.initialCropRegion.height),
            )
            newRegion = {
                ...this.initialCropRegion,
                x: roundToEven(newX),
                y: roundToEven(newY),
            }
        } else if (this.isResizing) {
            // Resize the crop region
            newRegion = this.calculateResizedRegion(deltaX, deltaY)
        } else {
            return
        }

        this.dispatchRegionChange(newRegion)
    }

    private calculateResizedRegion(deltaX: number, deltaY: number): CropRegion {
        if (this.recordingWidth === 0) return this.cropRegion

        const { x, y, width, height } = this.initialCropRegion
        const minSize = 10

        let newX = x,
            newY = y,
            newWidth = width,
            newHeight = height

        // Handle resize based on direction
        // x/y: must be non-negative and even for VideoFrame
        // width/height: must be positive (>= minSize)
        if (this.resizeDirection.includes('w')) {
            newX = roundToEven(clampCoordinate(Math.min(x + deltaX, x + width - minSize)))
            newWidth = clampDimension(width - (newX - x), minSize)
        }
        if (this.resizeDirection.includes('e')) {
            newWidth = clampDimension(Math.min(width + deltaX, this.recordingWidth - x), minSize)
        }
        if (this.resizeDirection.includes('n')) {
            newY = roundToEven(clampCoordinate(Math.min(y + deltaY, y + height - minSize)))
            newHeight = clampDimension(height - (newY - y), minSize)
        }
        if (this.resizeDirection.includes('s')) {
            newHeight = clampDimension(Math.min(height + deltaY, this.recordingHeight - y), minSize)
        }

        return { x: newX, y: newY, width: newWidth, height: newHeight }
    }

    private handlePointerUp = () => {
        this.isDragging = false
        this.isResizing = false
        this.resizeDirection = ''
    }

    private dispatchRegionChange(region: CropRegion) {
        this.dispatchEvent(
            new CustomEvent<CropRegionChangeEvent>('crop-region-change', {
                detail: { region },
                bubbles: true,
                composed: true,
            }),
        )
    }

    private renderDimOverlays() {
        if (!this.croppingEnabled || this.displayWidth === 0) return null

        const { x, y, width, height } = this.cropRegion
        const screenW = this.displayWidth
        const screenH = this.displayHeight
        const cropX = this.toPreviewCoords(x)
        const cropY = this.toPreviewCoords(y)
        const cropW = this.toPreviewCoords(width)
        const cropH = this.toPreviewCoords(height)

        // Create 4 overlay rectangles around the crop region
        return html`
            <!-- Top -->
            <div class="dim-overlay" style="top: 0; left: 0; width: ${screenW}px; height: ${cropY}px;"></div>
            <!-- Bottom -->
            <div
                class="dim-overlay"
                style="top: ${cropY + cropH}px; left: 0; width: ${screenW}px; height: ${
                    screenH - cropY - cropH
                }px;"></div>
            <!-- Left -->
            <div class="dim-overlay" style="top: ${cropY}px; left: 0; width: ${cropX}px; height: ${cropH}px;"></div>
            <!-- Right -->
            <div
                class="dim-overlay"
                style="top: ${cropY}px; left: ${cropX + cropW}px; width: ${
                    screenW - cropX - cropW
                }px; height: ${cropH}px;"></div>
        `
    }

    private renderCropOverlay() {
        if (!this.croppingEnabled || this.displayWidth === 0) return null

        const { x, y, width, height } = this.cropRegion
        const cropX = this.toPreviewCoords(x)
        const cropY = this.toPreviewCoords(y)
        const cropW = this.toPreviewCoords(width)
        const cropH = this.toPreviewCoords(height)
        const disabled = !this.canInteract

        return html`
            <div
                class="crop-overlay ${disabled ? 'disabled' : ''}"
                style="left: ${cropX}px; top: ${cropY}px; width: ${cropW}px; height: ${cropH}px;"
                @pointerdown=${this.handleCropPointerDown}
                @pointermove=${this.handlePointerMove}
                @pointerup=${this.handlePointerUp}>
                ${
                    !disabled
                        ? html`
                              <div
                                  class="resize-handle nw"
                                  @pointerdown=${(e: PointerEvent) => this.handleResizePointerDown(e, 'nw')}
                                  @pointermove=${this.handlePointerMove}
                                  @pointerup=${this.handlePointerUp}></div>
                              <div
                                  class="resize-handle ne"
                                  @pointerdown=${(e: PointerEvent) => this.handleResizePointerDown(e, 'ne')}
                                  @pointermove=${this.handlePointerMove}
                                  @pointerup=${this.handlePointerUp}></div>
                              <div
                                  class="resize-handle sw"
                                  @pointerdown=${(e: PointerEvent) => this.handleResizePointerDown(e, 'sw')}
                                  @pointermove=${this.handlePointerMove}
                                  @pointerup=${this.handlePointerUp}></div>
                              <div
                                  class="resize-handle se"
                                  @pointerdown=${(e: PointerEvent) => this.handleResizePointerDown(e, 'se')}
                                  @pointermove=${this.handlePointerMove}
                                  @pointerup=${this.handlePointerUp}></div>
                          `
                        : html`
                              <div class="resize-handle nw disabled"></div>
                              <div class="resize-handle ne disabled"></div>
                              <div class="resize-handle sw disabled"></div>
                              <div class="resize-handle se disabled"></div>
                          `
                }
            </div>
        `
    }

    override render() {
        const showPreview = this.isRecording && this.hasPreview

        return html`
            <div class="preview-container">
                <div class="preview-wrapper">
                    <canvas class="preview-canvas ${showPreview ? '' : 'hidden'}"></canvas>
                    ${
                        showPreview
                            ? html` ${this.renderDimOverlays()} ${this.renderCropOverlay()} `
                            : html` <p class="preview-message">${t('croppingPreviewMessage')}</p> `
                    }
                </div>
            </div>
        `
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'cropping-preview': CroppingPreview
    }
}
