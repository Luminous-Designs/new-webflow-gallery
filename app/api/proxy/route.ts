import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl.searchParams.get('url');

    if (!url) {
      return NextResponse.json({ error: 'URL parameter is required' }, { status: 400 });
    }

    // Parse URL to get domain info
    const urlObj = new URL(url);
    const templateDomain = urlObj.hostname;

    console.log(`[Proxy] Fetching: ${url}`);
    console.log(`[Proxy] Template domain: ${templateDomain}`);

    // Fetch the content
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      },
      redirect: 'follow'
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';

    // Only process HTML content
    if (!contentType.includes('text/html')) {
      const body = await response.arrayBuffer();
      return new NextResponse(body, {
        status: response.status,
        headers: {
          'Content-Type': contentType,
        },
      });
    }

    let html = await response.text();

    // Strip Cloudflare analytics scripts that frequently trigger noisy CORS errors when proxied.
    html = html.replace(
      /<script[^>]*src=["'][^"']*(?:cdn-cgi\/rum|static\.cloudflareinsights\.com)[^"']*["'][^>]*>\s*<\/script>/gi,
      ''
    );

    // Inject base tag to ensure relative URLs work correctly
    const baseTag = `<base href="${url}" />`;
    html = html.replace(/<head[^>]*>/i, `$&\n${baseTag}`);

    // Remove X-Frame-Options and CSP headers that might be in meta tags
    html = html.replace(/<meta[^>]*http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, '');
    html = html.replace(/<meta[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');

    // Remove the old preview mode indicator
    html = html.replace(/<div[^>]*>PREVIEW MODE<\/div>/gi, '');

    // Inject enhanced navigation handler script
    const navigationScript = `
      <script>
        (function() {
          const templateDomain = '${templateDomain}';
          const originalUrl = '${url}';

          console.log('🔒 Navigation handler initialized for domain:', templateDomain);

          // Helper function to check if URL is same domain
          function isSameDomain(url) {
            try {
              const urlObj = new URL(url, window.location.href);
              const domain = urlObj.hostname;

              // Check if it's the same domain or subdomain
              const isSame = domain === templateDomain ||
                           domain.endsWith('.' + templateDomain) ||
                           templateDomain.endsWith('.' + domain);

              console.log('Domain check:', { url: urlObj.href, domain, templateDomain, allowed: isSame });
              return isSame;
            } catch (e) {
              console.error('Error parsing URL:', url, e);
              return false;
            }
          }

          // Helper function to get absolute URL
          function getAbsoluteUrl(url) {
            try {
              return new URL(url, originalUrl).href;
            } catch {
              return url;
            }
          }

          // Intercept all link clicks
          document.addEventListener('click', function(e) {
            // Find the closest anchor element
            let link = e.target;
            while (link && link.tagName !== 'A') {
              link = link.parentElement;
            }

            if (link && link.href) {
              const href = link.href;
              const absoluteUrl = getAbsoluteUrl(href);

              console.log('🔗 Link clicked:', absoluteUrl);

              // Check if it's a special link (tel:, mailto:, javascript:, #)
              if (href.startsWith('tel:') ||
                  href.startsWith('mailto:') ||
                  href.startsWith('javascript:') ||
                  href === '#' ||
                  href.startsWith('#')) {
                e.preventDefault();
                console.log('Special link blocked:', href);
                return false;
              }

              // Check if URL is within the allowed domain
              if (isSameDomain(absoluteUrl)) {
                // Allow navigation within same domain by sending message to parent
                e.preventDefault();
                e.stopPropagation();

                // Send message to parent window to handle navigation
                if (window.parent !== window) {
                  window.parent.postMessage({
                    type: 'navigation',
                    url: absoluteUrl
                  }, '*');
                }
              } else {
                // Block external navigation
                e.preventDefault();
                e.stopPropagation();
                console.warn('❌ External navigation blocked:', absoluteUrl);

                // Optionally show a message to the user
                const message = document.createElement('div');
                message.innerHTML = 'External links are disabled in preview mode';
                message.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.8);color:white;padding:20px;border-radius:8px;font-size:14px;z-index:999999;font-family:system-ui';
                document.body.appendChild(message);
                setTimeout(() => message.remove(), 2000);
              }

              return false;
            }
          }, true);

          // Block form submissions
          document.addEventListener('submit', function(e) {
            e.preventDefault();
            console.log('Form submission blocked in preview mode');

            // Show message
            const message = document.createElement('div');
            message.innerHTML = 'Form submissions are disabled in preview mode';
            message.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.8);color:white;padding:20px;border-radius:8px;font-size:14px;z-index:999999;font-family:system-ui';
            document.body.appendChild(message);
            setTimeout(() => message.remove(), 2000);

            return false;
          }, true);

          // Override window.open
          const originalOpen = window.open;
          window.open = function(url) {
            console.log('window.open blocked:', url);
            return null;
          };

          // Best-effort overrides for JS-driven navigation.
          // Note: window.location is non-configurable in most browsers, so redefining it can throw.
          try {
            const loc = window.location;
            const originalAssign = loc.assign.bind(loc);
            const originalReplace = loc.replace.bind(loc);

            loc.assign = function(url) {
              const absoluteUrl = getAbsoluteUrl(url);
              if (isSameDomain(absoluteUrl)) {
                if (window.parent !== window) {
                  window.parent.postMessage({ type: 'navigation', url: absoluteUrl }, '*');
                } else {
                  originalAssign(absoluteUrl);
                }
              } else {
                console.warn('location.assign blocked - external domain:', absoluteUrl);
              }
            };

            loc.replace = function(url) {
              const absoluteUrl = getAbsoluteUrl(url);
              if (isSameDomain(absoluteUrl)) {
                if (window.parent !== window) {
                  window.parent.postMessage({ type: 'navigation', url: absoluteUrl }, '*');
                } else {
                  originalReplace(absoluteUrl);
                }
              } else {
                console.warn('location.replace blocked - external domain:', absoluteUrl);
              }
            };
          } catch (e) {
            console.warn('Failed to override location methods:', e);
          }

          try {
            const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
            if (locationDescriptor && locationDescriptor.configurable) {
              Object.defineProperty(window, 'location', {
                get: locationDescriptor.get,
                set: function(url) {
                  const absoluteUrl = getAbsoluteUrl(url);
                  if (isSameDomain(absoluteUrl)) {
                    if (window.parent !== window) {
                      window.parent.postMessage({ type: 'navigation', url: absoluteUrl }, '*');
                    }
                  } else {
                    console.warn('Location change blocked - external domain:', absoluteUrl);
                  }
                }
              });
            } else {
              console.log('window.location is not configurable; skipping setter override');
            }
          } catch (e) {
            console.warn('Failed to override window.location property:', e);
          }

          // Override history methods
          const originalPushState = history.pushState;
          const originalReplaceState = history.replaceState;

          history.pushState = function(state, title, url) {
            if (url) {
              const absoluteUrl = getAbsoluteUrl(url);
              if (isSameDomain(absoluteUrl)) {
                originalPushState.call(this, state, title, url);
                if (window.parent !== window) {
                  window.parent.postMessage({
                    type: 'navigation',
                    url: absoluteUrl
                  }, '*');
                }
              } else {
                console.warn('pushState blocked - external domain:', absoluteUrl);
              }
            }
          };

          history.replaceState = function(state, title, url) {
            if (url) {
              const absoluteUrl = getAbsoluteUrl(url);
              if (isSameDomain(absoluteUrl)) {
                originalReplaceState.call(this, state, title, url);
              } else {
                console.warn('replaceState blocked - external domain:', absoluteUrl);
              }
            }
          };

          // Add a subtle preview indicator
          const indicator = document.createElement('div');
          indicator.innerHTML = '👁️ Preview Mode';
          indicator.style.cssText = 'position:fixed;bottom:10px;right:10px;background:rgba(99,102,241,0.9);color:white;padding:6px 12px;border-radius:6px;font-size:12px;z-index:99999;font-family:system-ui;pointer-events:none;';
          document.addEventListener('DOMContentLoaded', function() {
            document.body.appendChild(indicator);
          });
        })();
      </script>
    `;

    // Inject the script before closing body tag
    html = html.replace(/<\/body>/i, `${navigationScript}\n</body>`);

    // Return the modified HTML with permissive headers
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'ALLOWALL',
        'Content-Security-Policy': "frame-ancestors *;",
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });

  } catch (error) {
    console.error('[Proxy] Error:', error);

    // Return a fallback HTML with error message
    const errorHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Preview Error</title>
        <style>
          body {
            font-family: system-ui, -apple-system, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .error-container {
            background: white;
            padding: 2rem;
            border-radius: 1rem;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
            max-width: 500px;
            text-align: center;
          }
          h1 {
            color: #1a202c;
            margin-bottom: 1rem;
          }
          p {
            color: #4a5568;
            margin-bottom: 1.5rem;
          }
          .error-details {
            background: #f7fafc;
            padding: 1rem;
            border-radius: 0.5rem;
            margin-top: 1rem;
            font-size: 0.875rem;
            color: #718096;
            word-break: break-word;
          }
        </style>
      </head>
      <body>
        <div class="error-container">
          <h1>Preview Unavailable</h1>
          <p>We couldn't load the preview for this template.</p>
          <div class="error-details">
            ${error instanceof Error ? error.message : 'Unknown error occurred'}
          </div>
        </div>
      </body>
      </html>
    `;

    return new NextResponse(errorHtml, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8'
      }
    });
  }
}
