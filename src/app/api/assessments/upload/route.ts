import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function extractPdfText(buffer: Buffer): Promise<string> {
  // Dynamic import avoids pdf-parse's build-time test file check
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdf = require('pdf-parse');
  const data = await pdf(buffer);
  return data.text || '';
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const formData = await request.formData();

    const file = formData.get('file') as File | null;
    const orgId = formData.get('org_id') as string | null;
    const contactId = formData.get('contact_id') as string | null;
    const title = formData.get('title') as string | null;
    const assessmentType = formData.get('assessment_type') as string || 'general';
    const assessmentDate = formData.get('assessment_date') as string | null;
    const notes = formData.get('notes') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF files are accepted' }, { status: 400 });
    }

    if (!orgId && !contactId) {
      return NextResponse.json(
        { error: 'Either org_id or contact_id is required' },
        { status: 400 }
      );
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Extract text from PDF
    let rawText = '';
    try {
      rawText = await extractPdfText(buffer);
    } catch (pdfErr) {
      console.error('PDF text extraction failed:', pdfErr);
      // Continue without text — file will still be stored
    }

    // Upload PDF to Supabase Storage
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${orgId || 'unlinked'}/${timestamp}_${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from('assessments')
      .upload(storagePath, buffer, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return NextResponse.json(
        { error: `File upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    // Get a signed URL (valid for 10 years — essentially permanent for internal use)
    const { data: urlData } = await supabase.storage
      .from('assessments')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 365 * 10);

    const fileUrl = urlData?.signedUrl || storagePath;

    // Create assessment record
    const displayTitle =
      title || `${assessmentType.replace(/_/g, ' ')} Assessment — ${file.name}`;

    const { data: assessment, error: insertError } = await supabase
      .from('assessments')
      .insert({
        org_id: orgId || null,
        contact_id: contactId || null,
        title: displayTitle,
        assessment_type: assessmentType,
        assessment_date: assessmentDate || new Date().toISOString().split('T')[0],
        file_name: file.name,
        file_url: fileUrl,
        file_type: 'application/pdf',
        raw_text: rawText || null,
        notes: notes || null,
      })
      .select('*, contacts(id, name), organizations(id, name)')
      .single();

    if (insertError) {
      console.error('Assessment insert error:', insertError);
      return NextResponse.json(
        { error: `Failed to create assessment: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        assessment,
        has_text: !!rawText,
        text_length: rawText.length,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('Assessment upload error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
