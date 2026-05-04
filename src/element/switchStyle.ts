import { css } from 'lit'

export const switchLabelStyle = css`
    .switch-label {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 1rem;
        width: fit-content;
        max-width: 100%;
        margin: 0.9rem 0 0.9rem;
        font-size: 0.9rem;
    }

    .switch-label md-switch {
        margin-bottom: 0;
        flex-shrink: 0;
    }
`
