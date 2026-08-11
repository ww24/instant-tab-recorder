function switchLegalTab(tabName: 'privacy' | 'terms', updateHash = true) {
    const privacyBtn = document.getElementById('tab-privacy-btn')
    const termsBtn = document.getElementById('tab-terms-btn')
    const privacyPanel = document.getElementById('privacy-tab-panel')
    const termsPanel = document.getElementById('terms-tab-panel')

    if (!privacyBtn || !termsBtn || !privacyPanel || !termsPanel) return

    if (tabName === 'privacy') {
        privacyBtn.classList.add('active')
        privacyBtn.setAttribute('aria-selected', 'true')
        termsBtn.classList.remove('active')
        termsBtn.setAttribute('aria-selected', 'false')

        privacyPanel.classList.add('active')
        privacyPanel.style.display = 'block'
        termsPanel.classList.remove('active')
        termsPanel.style.display = 'none'
    } else {
        termsBtn.classList.add('active')
        termsBtn.setAttribute('aria-selected', 'true')
        privacyBtn.classList.remove('active')
        privacyBtn.setAttribute('aria-selected', 'false')

        termsPanel.classList.add('active')
        termsPanel.style.display = 'block'
        privacyPanel.classList.remove('active')
        privacyPanel.style.display = 'none'
    }

    if (updateHash) {
        history.replaceState(null, '', `#${tabName}`)
    }
}

function initLegalTabs() {
    const privacyBtn = document.getElementById('tab-privacy-btn')
    const termsBtn = document.getElementById('tab-terms-btn')

    privacyBtn?.addEventListener('click', () => switchLegalTab('privacy'))
    termsBtn?.addEventListener('click', () => switchLegalTab('terms'))

    // Handle cross-document / relative links inside Privacy & Terms panels
    document.querySelectorAll('.privacy-content a').forEach(link => {
        const href = link.getAttribute('href') || ''
        if (/TERMS/i.test(href)) {
            link.addEventListener('click', e => {
                e.preventDefault()
                switchLegalTab('terms')
                const legalSection = document.getElementById('terms')
                legalSection?.scrollIntoView({ behavior: 'smooth' })
            })
        } else if (/PRIVACY/i.test(href)) {
            link.addEventListener('click', e => {
                e.preventDefault()
                switchLegalTab('privacy')
                const legalSection = document.getElementById('terms')
                legalSection?.scrollIntoView({ behavior: 'smooth' })
            })
        }
    })

    // Handle header and external anchor links to #privacy and #terms
    document.querySelectorAll('a[href="#privacy"], a[href="#terms"]').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault()
            const targetHash = link.getAttribute('href') === '#privacy' ? 'privacy' : 'terms'
            switchLegalTab(targetHash)
            const legalSection = document.getElementById('terms')
            legalSection?.scrollIntoView({ behavior: 'smooth' })
        })
    })

    // Handle initial URL hash on load (support #privacy for backwards compatibility)
    const hash = window.location.hash.toLowerCase()
    if (hash === '#privacy') {
        switchLegalTab('privacy', false)
        document.getElementById('terms')?.scrollIntoView({ behavior: 'smooth' })
    } else if (hash === '#terms' || hash === '#legal') {
        switchLegalTab('terms', false)
        document.getElementById('terms')?.scrollIntoView({ behavior: 'smooth' })
    } else {
        // Default tab is Terms
        switchLegalTab('terms', false)
    }
}

// SPA-like navigation for logo link using History API
document.getElementById('logo-link')?.addEventListener('click', e => {
    e.preventDefault()
    // Update URL without page reload
    const basePath = window.location.pathname + window.location.search
    if (window.location.hash) {
        history.pushState(null, '', basePath)
    }
    // Smooth scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' })
})

// Handle browser back/forward navigation
window.addEventListener('popstate', () => {
    const hash = window.location.hash.toLowerCase()
    if (hash === '#privacy') {
        switchLegalTab('privacy', false)
        document.getElementById('terms')?.scrollIntoView({ behavior: 'smooth' })
    } else if (hash === '#terms' || hash === '#legal') {
        switchLegalTab('terms', false)
        document.getElementById('terms')?.scrollIntoView({ behavior: 'smooth' })
    } else if (hash) {
        const target = document.querySelector(hash)
        if (target) {
            target.scrollIntoView({ behavior: 'smooth' })
        }
    } else {
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }
})

// Initialize tabs on DOM content loaded / execution
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLegalTabs)
} else {
    initLegalTabs()
}
