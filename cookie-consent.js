document.addEventListener('DOMContentLoaded', () => {
    // Inject HTML for Cookie Banner
    const bannerHTML = `
        <div id="cookieBanner" class="cookie-banner">
            <div class="cookie-content">
                <h3>Your Privacy Matters</h3>
                <p>We use cookies and tracking technologies to enhance your browsing experience, analyze site traffic, and personalize content. You can customize your preferences below.</p>
            </div>
            <div class="cookie-buttons">
                <button id="cookieCustomizeBtn" class="cookie-btn cookie-btn-customize">Customize</button>
                <button id="cookieAcceptAllBtn" class="cookie-btn cookie-btn-accept">Accept All</button>
            </div>
        </div>
    `;

    // Inject HTML for Cookie Modal
    const modalHTML = `
        <div id="cookieModal" class="cookie-modal-overlay">
            <div class="cookie-modal">
                <div class="cookie-modal-header">
                    <h2>Cookie Preferences</h2>
                    <button id="cookieModalCloseBtn" class="cookie-modal-close">&times;</button>
                </div>
                
                <p style="margin-bottom: 2rem; font-size: 0.95rem; color: #5a544e;">
                    We use cookies to ensure you get the best experience on our website. Review and manage your tracking preferences below.
                </p>

                <div class="cookie-option">
                    <div class="cookie-option-info">
                        <h4>Strictly Necessary Cookies</h4>
                        <p>These cookies are essential for the website to function properly. They cannot be disabled.</p>
                    </div>
                    <label class="switch">
                        <input type="checkbox" checked disabled>
                        <span class="slider"></span>
                    </label>
                </div>

                <div class="cookie-option">
                    <div class="cookie-option-info">
                        <h4>Analytics Cookies</h4>
                        <p>These cookies help us understand how visitors interact with our website, allowing us to improve performance and user experience.</p>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="toggleAnalytics" checked>
                        <span class="slider"></span>
                    </label>
                </div>

                <div class="cookie-option">
                    <div class="cookie-option-info">
                        <h4>Marketing & Tracking Cookies</h4>
                        <p>We use these to deliver personalized advertisements and track cross-site browsing behavior to provide relevant promotions.</p>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="toggleMarketing" checked>
                        <span class="slider"></span>
                    </label>
                </div>

                <div class="cookie-modal-footer">
                    <button id="cookieSaveBtn" class="cookie-btn cookie-btn-accept">Save Preferences</button>
                </div>
            </div>
        </div>
    `;

    // Append to body
    document.body.insertAdjacentHTML('beforeend', bannerHTML + modalHTML);

    const cookieBanner = document.getElementById('cookieBanner');
    const cookieModal = document.getElementById('cookieModal');

    // Check local storage for consent
    const consentState = localStorage.getItem('rawSushiCookieConsent');

    if (!consentState) {
        // Delay showing banner slightly for visual effect
        setTimeout(() => {
            cookieBanner.classList.add('show');
        }, 1000);
    } else {
        // If consent exists, apply scripts (Simulated)
        applyTrackingScripts(JSON.parse(consentState));
    }

    // Accept All Button
    document.getElementById('cookieAcceptAllBtn').addEventListener('click', () => {
        saveConsent(true, true);
        cookieBanner.classList.remove('show');
    });

    // Customize Button
    document.getElementById('cookieCustomizeBtn').addEventListener('click', () => {
        cookieModal.classList.add('show');
    });

    // Close Modal Button
    document.getElementById('cookieModalCloseBtn').addEventListener('click', () => {
        cookieModal.classList.remove('show');
    });

    // Save Preferences Button
    document.getElementById('cookieSaveBtn').addEventListener('click', () => {
        const analytics = document.getElementById('toggleAnalytics').checked;
        const marketing = document.getElementById('toggleMarketing').checked;
        saveConsent(analytics, marketing);
        cookieModal.classList.remove('show');
        cookieBanner.classList.remove('show');
    });

    // Function to save consent to LocalStorage
    function saveConsent(analytics, marketing) {
        const consentData = {
            strictlyNecessary: true,
            analytics: analytics,
            marketing: marketing,
            timestamp: new Date().toISOString()
        };
        localStorage.setItem('rawSushiCookieConsent', JSON.stringify(consentData));
        applyTrackingScripts(consentData);
    }

    // Function to physically activate or block tracking scripts based on consent
    function applyTrackingScripts(consentData) {
        console.log("Consent Applied:", consentData);
        // Place actual analytic and marketing loading logic here
        // if (consentData.analytics) { loadGoogleAnalytics(); }
        // if (consentData.marketing) { loadFacebookPixel(); }
    }
});
