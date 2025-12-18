'use client';

import { useState, useEffect } from 'react';
import TemplateGallery from '@/components/template-gallery';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast, Toaster } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, CheckCircle, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { toAssetUrl } from '@/lib/assets';

type Step = 'gallery' | 'details' | 'contract' | 'pricing' | 'checkout' | 'success';

interface Template {
  id: number;
  template_id: string;
  name: string;
  slug: string;
  author_name?: string;
  live_preview_url: string;
  screenshot_path?: string;
}

interface FormData {
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  website: string;
  industry: string;
  projectTimeline: string;
  additionalNotes: string;
}

const generateSessionId = () => {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
      return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
    }
  }
  return `session-${Math.random().toString(36).slice(2)}-${Date.now()}`;
};

const getOrCreateSessionId = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  const existing = window.localStorage.getItem('session_id');
  if (existing) {
    return existing;
  }
  const newId = generateSessionId();
  window.localStorage.setItem('session_id', newId);
  return newId;
};

export default function Home() {
  const [currentStep, setCurrentStep] = useState<Step>('gallery');
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [formData, setFormData] = useState<FormData>({
    businessName: '',
    contactName: '',
    email: '',
    phone: '',
    website: '',
    industry: '',
    projectTimeline: '',
    additionalNotes: ''
  });
  const [signature, setSignature] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [pageCount, setPageCount] = useState(0);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isPriceApproved, setIsPriceApproved] = useState(false);

  // Track visitor session
  useEffect(() => {
    const sessionId = getOrCreateSessionId();
    if (!sessionId) {
      return;
    }

    // Update visitor tracking
    const updateVisitor = async () => {
      await fetch('/api/visitor/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          currentStep,
          selectedTemplateId: selectedTemplate?.id
        })
      });
    };

    updateVisitor();
  }, [currentStep, selectedTemplate]);

  const handleTemplateSelect = (template: Template) => {
    setSelectedTemplate(template);
    setCurrentStep('details');
  };

  const handleDetailsSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate form
    if (!formData.businessName || !formData.contactName || !formData.email) {
      toast.error('Please fill in all required fields');
      return;
    }

    setCurrentStep('contract');
  };

  const handleContractSign = () => {
    if (!signature.trim()) {
      toast.error('Please enter your name as signature');
      return;
    }

    setCurrentStep('pricing');
  };

  const calculatePricing = async () => {
    if (!websiteUrl.trim()) {
      toast.error('Please enter your website URL');
      return;
    }

    setIsCalculating(true);

    try {
      // Extract domain and check sitemap
      const url = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`);
      const sitemapUrl = `${url.origin}/sitemap.xml`;

      const response = await fetch('/api/calculate-pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sitemapUrl, websiteUrl })
      });

      const data = await response.json();

      if (response.ok) {
        setPageCount(data.pageCount);
        setIsPriceApproved(data.approved);

        if (!data.approved) {
          // Send email for large sites
          await fetch('/api/send-inquiry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              formData,
              template: selectedTemplate,
              websiteUrl,
              pageCount: data.pageCount
            })
          });

          toast.info('Your website is larger than usual. We\'ll contact you shortly!');
        } else {
          toast.success('Great! Your website qualifies for our standard pricing.');
          setCurrentStep('checkout');
        }
      } else {
        toast.error(data.error || 'Failed to calculate pricing');
      }
    } catch {
      toast.error('Failed to analyze your website. Please try again.');
    } finally {
      setIsCalculating(false);
    }
  };

  const renderPersistentBar = () => {
    if (currentStep === 'gallery' || !selectedTemplate) return null;

    return (
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg z-40">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {selectedTemplate.screenshot_path && toAssetUrl(selectedTemplate.screenshot_path) && (
                <div className="w-16 h-16 rounded overflow-hidden">
                  <Image
                    src={toAssetUrl(selectedTemplate.screenshot_path) || ''}
                    alt={selectedTemplate.name}
                    width={64}
                    height={64}
                    sizes="64px"
                    className="object-cover"
                  />
                </div>
              )}
              <div>
                <p className="font-semibold">{selectedTemplate.name}</p>
                <p className="text-sm text-gray-600">Selected Template</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setCurrentStep('gallery')}
              >
                Change Template
              </Button>
              {currentStep !== 'details' && (
                <Button
                  variant="outline"
                  onClick={() => {
                    const steps: Step[] = ['gallery', 'details', 'contract', 'pricing', 'checkout', 'success'];
                    const currentIndex = steps.indexOf(currentStep);
                    if (currentIndex > 1) {
                      setCurrentStep(steps[currentIndex - 1]);
                    }
                  }}
                >
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Back
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <AnimatePresence mode="wait">
        {currentStep === 'gallery' && (
          <motion.div
            key="gallery"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <TemplateGallery onTemplateSelect={handleTemplateSelect} />
          </motion.div>
        )}

        {currentStep === 'details' && (
          <motion.div
            key="details"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="min-h-screen bg-gray-50 py-12 pb-24"
          >
            <div className="container mx-auto px-4 max-w-2xl">
              <Card className="p-8">
                <h2 className="text-2xl font-bold mb-6">Business Details</h2>
                <form onSubmit={handleDetailsSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Business Name *
                    </label>
                    <Input
                      value={formData.businessName}
                      onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Contact Name *
                    </label>
                    <Input
                      value={formData.contactName}
                      onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Email *
                      </label>
                      <Input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Phone
                      </label>
                      <Input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Current Website
                    </label>
                    <Input
                      type="url"
                      value={formData.website}
                      onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                      placeholder="https://..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Industry
                    </label>
                    <Input
                      value={formData.industry}
                      onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Project Timeline
                    </label>
                    <Input
                      value={formData.projectTimeline}
                      onChange={(e) => setFormData({ ...formData, projectTimeline: e.target.value })}
                      placeholder="e.g., 2-3 weeks"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Additional Notes
                    </label>
                    <Textarea
                      value={formData.additionalNotes}
                      onChange={(e) => setFormData({ ...formData, additionalNotes: e.target.value })}
                      rows={4}
                    />
                  </div>

                  <Button type="submit" className="w-full" size="lg">
                    Continue to Contract
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </form>
              </Card>
            </div>
          </motion.div>
        )}

        {currentStep === 'contract' && (
          <motion.div
            key="contract"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="min-h-screen bg-gray-50 py-12 pb-24"
          >
            <div className="container mx-auto px-4 max-w-4xl">
              <Card className="p-8">
                <h2 className="text-2xl font-bold mb-6">Service Agreement</h2>

                <div className="bg-gray-50 p-6 rounded-lg mb-6 max-h-96 overflow-y-auto">
                  <h3 className="font-semibold mb-4">Webflow Migration & Redesign Service Agreement</h3>

                  <div className="space-y-4 text-sm">
                    <p>This agreement is between Luminous (&quot;Service Provider&quot;) and {formData.businessName || '[Client Name]'} (&quot;Client&quot;).</p>

                    <div>
                      <h4 className="font-semibold mb-2">1. Services</h4>
                      <p>Service Provider agrees to:</p>
                      <ul className="list-disc pl-6 mt-2">
                        <li>Migrate Client&apos;s existing website to Webflow platform</li>
                        <li>Redesign the website using the selected template: {selectedTemplate?.name}</li>
                        <li>Ensure responsive design across all devices</li>
                        <li>Provide basic SEO setup and optimization</li>
                        <li>Deliver within 2-3 weeks from payment confirmation</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-semibold mb-2">2. Pricing</h4>
                      <p>Total cost: $1,200 USD for websites with up to 100 pages (excluding blog posts)</p>
                    </div>

                    <div>
                      <h4 className="font-semibold mb-2">3. Payment Terms</h4>
                      <p>Full payment required upfront via Stripe secure payment processing.</p>
                    </div>

                    <div>
                      <h4 className="font-semibold mb-2">4. Revisions</h4>
                      <p>Up to 3 rounds of revisions included. Additional revisions billed at $150/hour.</p>
                    </div>

                    <div>
                      <h4 className="font-semibold mb-2">5. Intellectual Property</h4>
                      <p>Upon full payment, all work product becomes property of the Client.</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      E-Signature (Type your full name) *
                    </label>
                    <Input
                      value={signature}
                      onChange={(e) => setSignature(e.target.value)}
                      placeholder={formData.contactName || 'Your Full Name'}
                      className="font-serif text-lg"
                    />
                  </div>

                  <div className="text-sm text-gray-600">
                    By typing your name above, you agree to the terms and conditions of this service agreement.
                  </div>

                  <Button
                    onClick={handleContractSign}
                    className="w-full"
                    size="lg"
                    disabled={!signature.trim()}
                  >
                    Sign & Continue
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </Card>
            </div>
          </motion.div>
        )}

        {currentStep === 'pricing' && (
          <motion.div
            key="pricing"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="min-h-screen bg-gray-50 py-12 pb-24"
          >
            <div className="container mx-auto px-4 max-w-2xl">
              <Card className="p-8">
                <h2 className="text-2xl font-bold mb-6">Calculate Your Investment</h2>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Your Website URL *
                    </label>
                    <Input
                      value={websiteUrl}
                      onChange={(e) => setWebsiteUrl(e.target.value)}
                      placeholder="https://www.yourwebsite.com"
                      disabled={isCalculating}
                    />
                    <p className="text-sm text-gray-600 mt-2">
                      We&apos;ll analyze your sitemap to calculate the migration cost
                    </p>
                  </div>

                  <Button
                    onClick={calculatePricing}
                    className="w-full"
                    size="lg"
                    disabled={isCalculating || !websiteUrl.trim()}
                  >
                    {isCalculating ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Analyzing Website...
                      </>
                    ) : (
                      <>
                        Calculate Pricing
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </>
                    )}
                  </Button>

                  {pageCount > 0 && (
                    <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between mb-4">
                        <span className="font-medium">Pages Detected:</span>
                        <Badge variant={isPriceApproved ? 'default' : 'destructive'}>
                          {pageCount} pages
                        </Badge>
                      </div>

                      {isPriceApproved ? (
                        <div className="space-y-3">
                          <div className="flex items-center text-green-600">
                            <CheckCircle className="h-5 w-5 mr-2" />
                            <span>Your website qualifies for standard pricing!</span>
                          </div>
                          <div className="text-2xl font-bold">
                            Total: $1,200 USD
                          </div>
                          <p className="text-sm text-gray-600">
                            Includes migration and redesign with selected template
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-orange-600">
                            Your website has more than 100 pages. We need to provide a custom quote.
                          </p>
                          <p className="text-sm">
                            We&apos;ve sent your information to our team. You&apos;ll receive a custom quote within 24 hours.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </motion.div>
        )}

        {currentStep === 'checkout' && (
          <motion.div
            key="checkout"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="min-h-screen bg-gray-50 py-12 pb-24"
          >
            <div className="container mx-auto px-4 max-w-2xl">
              <Card className="p-8">
                <h2 className="text-2xl font-bold mb-6">Complete Your Purchase</h2>

                <div className="space-y-6">
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h3 className="font-semibold mb-3">Order Summary</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Template: {selectedTemplate?.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Website Migration ({pageCount} pages)</span>
                        <span>$800</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Template Customization & Redesign</span>
                        <span>$400</span>
                      </div>
                      <div className="border-t pt-2 font-semibold">
                        <div className="flex justify-between">
                          <span>Total</span>
                          <span>$1,200 USD</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="text-center">
                    <p className="text-gray-600 mb-4">
                      You will be redirected to Stripe for secure payment processing
                    </p>
                    <Button
                      size="lg"
                      className="w-full"
                      onClick={() => {
                        toast.info('Stripe integration would go here');
                        // Stripe checkout would be initiated here
                      }}
                    >
                      Proceed to Payment
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {renderPersistentBar()}
      <Toaster position="top-center" />
    </>
  );
}
