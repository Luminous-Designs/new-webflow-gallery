import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

let cachedResend: Resend | null = null;

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === 'your_resend_api_key_here') {
    return null;
  }
  if (!cachedResend) {
    cachedResend = new Resend(apiKey);
  }
  return cachedResend;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { formData, template, websiteUrl, pageCount } = body;

    const emailContent = `
      <h2>New Webflow Migration Inquiry (Large Site)</h2>

      <h3>Customer Details:</h3>
      <ul>
        <li><strong>Business Name:</strong> ${formData.businessName}</li>
        <li><strong>Contact Name:</strong> ${formData.contactName}</li>
        <li><strong>Email:</strong> ${formData.email}</li>
        <li><strong>Phone:</strong> ${formData.phone || 'Not provided'}</li>
        <li><strong>Current Website:</strong> ${formData.website || 'Not provided'}</li>
        <li><strong>Industry:</strong> ${formData.industry || 'Not provided'}</li>
        <li><strong>Timeline:</strong> ${formData.projectTimeline || 'Not provided'}</li>
      </ul>

      <h3>Selected Template:</h3>
      <p>${template?.name || 'Not selected'}</p>

      <h3>Website Analysis:</h3>
      <ul>
        <li><strong>Analyzed URL:</strong> ${websiteUrl}</li>
        <li><strong>Page Count:</strong> ${pageCount}</li>
        <li><strong>Status:</strong> Requires custom pricing (over 100 pages)</li>
      </ul>

      <h3>Additional Notes:</h3>
      <p>${formData.additionalNotes || 'None'}</p>

      <hr>
      <p><em>This inquiry was automatically generated from the Webflow Migration Service portal.</em></p>
    `;

    const resend = getResendClient();

    if (resend) {
      // Send via Resend if configured
      await resend.emails.send({
        from: 'Webflow Migration <onboarding@resend.dev>',
        to: process.env.ADMIN_EMAIL || 'developer.luminous@gmail.com',
        subject: `Custom Quote Request - ${formData.businessName}`,
        html: emailContent
      });
    } else {
      // Log to console if Resend not configured
      console.log('Email would be sent (Resend not configured):');
      console.log('To:', process.env.ADMIN_EMAIL || 'developer.luminous@gmail.com');
      console.log('Subject:', `Custom Quote Request - ${formData.businessName}`);
      console.log('Content:', emailContent);
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Email send error:', error);
    return NextResponse.json(
      { error: 'Failed to send inquiry' },
      { status: 500 }
    );
  }
}
