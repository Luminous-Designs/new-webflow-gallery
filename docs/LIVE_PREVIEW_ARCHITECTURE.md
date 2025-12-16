# Live Preview Architecture Documentation

## Overview

The live preview system allows users to interact with Webflow templates in a sandboxed iframe environment within a modal dialog. It provides full navigation capabilities within the template's domain while blocking external navigation to maintain user engagement within the application.

## Architecture Components

### 1. Template Preview Component (`/components/template-preview.tsx`)

The main React component that renders the preview modal with:
- **Navigation Controls**: Back, Forward, Home buttons
- **View Modes**: Desktop and Mobile responsive views
- **URL Display**: Shows current page being previewed
- **History Management**: Tracks navigation history for browser-like experience

### 2. Proxy API Route (`/app/api/proxy/route.ts`)

A Next.js API route that acts as a proxy server to:
- Fetch template HTML content from Webflow domains
- Inject JavaScript for navigation control
- Add security headers to allow iframe embedding
- Handle cross-origin resource sharing (CORS)

### 3. Navigation Interceptor (Injected JavaScript)

JavaScript code injected into proxied pages that:
- Intercepts all link clicks
- Validates domain permissions
- Blocks external navigation attempts
- Sends navigation messages to parent window
- Prevents form submissions

## How It Works

### Request Flow

```
User clicks Preview → Component creates iframe → Iframe loads /api/proxy?url=template_url
                                                            ↓
                                                    Proxy fetches HTML
                                                            ↓
                                                    Injects navigation script
                                                            ↓
                                                    Returns modified HTML
                                                            ↓
                                                    User interacts with page
                                                            ↓
                                                    Navigation intercepted
                                                            ↓
                                                    PostMessage to parent
                                                            ↓
                                                    Parent updates iframe URL
```

### Domain Validation

The system validates URLs to ensure they belong to the template's domain:

```javascript
// Allowed:
- template.webflow.io (exact match)
- www.template.webflow.io (subdomain)
- page2.template.webflow.io (any page on domain)

// Blocked:
- webflow.com (external)
- google.com (external)
- differenttemplate.webflow.io (different template)
```

## Scalability & Multi-User Support

### Concurrent User Handling

**Yes, the proxy system fully supports multiple concurrent users** previewing different templates simultaneously:

1. **Stateless Design**: Each request is completely independent
   - No shared state between requests
   - Each proxy request fetches fresh content
   - Navigation history stored client-side

2. **Request Isolation**: Every user's preview session is isolated
   ```
   User A → Preview Template X → Proxy fetches Template X
   User B → Preview Template Y → Proxy fetches Template Y
   (Both work simultaneously without interference)
   ```

3. **Resource Efficiency**:
   - Proxy doesn't store template data
   - No server-side session management
   - Minimal memory footprint per request

### VPS Deployment Considerations

When deployed on a VPS, the system scales well:

#### Advantages:
- **Linear Scalability**: Each request is independent
- **No Database Overhead**: Proxy doesn't use database
- **CDN Compatible**: Static assets served from Webflow's CDN
- **Caching Potential**: Can add Redis/CDN for template caching

#### Performance Optimizations:

1. **Rate Limiting** (Recommended):
   ```javascript
   // Add to proxy route
   const rateLimit = new Map();
   const MAX_REQUESTS_PER_MINUTE = 60;
   ```

2. **Response Caching**:
   ```javascript
   // Cache successful responses for 5 minutes
   const cache = new Map();
   const CACHE_TTL = 5 * 60 * 1000;
   ```

3. **Connection Pooling**:
   - Node.js automatically handles HTTP connection pooling
   - Configure `http.globalAgent.maxSockets` for concurrent connections

#### Resource Requirements:

For a VPS handling concurrent users:
- **Memory**: ~50-100MB per active preview session
- **CPU**: Minimal (mostly I/O bound)
- **Bandwidth**: Depends on template size (~1-5MB per preview load)
- **Concurrent Users**:
  - 2GB RAM VPS: ~20-40 concurrent previews
  - 4GB RAM VPS: ~80-160 concurrent previews
  - 8GB RAM VPS: ~200-400 concurrent previews

## Security Considerations

### 1. Domain Whitelisting
Currently removed but can be re-added:
```javascript
const validDomains = ['webflow.io', 'webflow.com'];
const isValid = validDomains.some(domain => urlObj.hostname.endsWith(domain));
```

### 2. Content Security Policy
The proxy removes restrictive CSP headers but adds its own:
```javascript
'Content-Security-Policy': "frame-ancestors 'self'"
```

### 3. XSS Prevention
- All navigation happens via PostMessage API
- No direct DOM manipulation from parent to child
- URLs validated before navigation

### 4. Form Submission Blocking
All forms are disabled to prevent:
- Data leakage
- Unintended actions
- Security vulnerabilities

## Limitations

1. **Cross-Origin Restrictions**:
   - Cannot access iframe's actual URL (browser security)
   - Cannot modify cookies or localStorage
   - Cannot access certain JavaScript APIs

2. **Authentication**:
   - Cannot preview password-protected pages
   - Cannot maintain login sessions

3. **Dynamic Content**:
   - Some JavaScript-heavy features may not work
   - WebGL/Canvas content may have issues
   - Video/audio may have autoplay restrictions

## Troubleshooting

### Common Issues:

1. **Infinite Loading**:
   - Check if template URL is accessible
   - Verify proxy route is working
   - Check browser console for CORS errors

2. **Navigation Not Working**:
   - Ensure JavaScript is enabled
   - Check if PostMessage is being blocked
   - Verify domain validation logic

3. **External Links**:
   - Working as designed (blocked)
   - Shows user-friendly message
   - Prevents accidental navigation away

## Future Enhancements

1. **Performance**:
   - Add Redis caching for frequently viewed templates
   - Implement CDN for proxy responses
   - Add request batching for multiple previews

2. **Features**:
   - Add screenshot capability
   - Implement page annotation tools
   - Add template comparison view

3. **Analytics**:
   - Track most viewed pages within templates
   - Monitor preview duration
   - Analyze user navigation patterns

## Testing

### Unit Tests (Recommended):
```javascript
describe('Proxy Route', () => {
  it('should fetch and modify HTML', async () => {
    // Test proxy fetches content
  });

  it('should inject navigation script', async () => {
    // Test script injection
  });

  it('should handle multiple concurrent requests', async () => {
    // Test scalability
  });
});
```

### Load Testing:
```bash
# Using Apache Bench
ab -n 1000 -c 10 http://localhost:3000/api/proxy?url=template.webflow.io

# Using Artillery
artillery quick --count 50 --num 10 http://localhost:3000/api/proxy?url=template.webflow.io
```

## Deployment Checklist

- [ ] Configure rate limiting
- [ ] Set up monitoring (e.g., New Relic, DataDog)
- [ ] Add error logging (e.g., Sentry)
- [ ] Configure CDN for static assets
- [ ] Set up health check endpoint
- [ ] Add request timeout handling
- [ ] Configure NGINX/Apache reverse proxy
- [ ] Set up SSL certificates
- [ ] Add DDoS protection (Cloudflare)

## Support & Maintenance

### Monitoring Metrics:
- Average response time
- Error rate
- Concurrent connections
- Memory usage
- Cache hit ratio

### Log Analysis:
```javascript
// Add structured logging
console.log({
  timestamp: new Date().toISOString(),
  action: 'proxy_request',
  url: targetUrl,
  duration: responseTime,
  status: response.status
});
```