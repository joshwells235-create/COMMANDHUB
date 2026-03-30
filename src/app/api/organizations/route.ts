import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await request.json();

    const { name, industry, status, strategic_value, notes, contacts,
      website, phone, address, company_size, description } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }

    // Create the organization
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name: name.trim(),
        industry: industry || null,
        status: status || 'active',
        strategic_value: strategic_value || 'standard',
        notes: notes || null,
        website: website || null,
        phone: phone || null,
        address: address || null,
        company_size: company_size || null,
        description: description || null,
      })
      .select()
      .single();

    if (orgError) {
      return NextResponse.json({ error: orgError.message }, { status: 500 });
    }

    // Create contacts if provided
    let createdContacts: unknown[] = [];
    if (Array.isArray(contacts) && contacts.length > 0) {
      const contactRows = contacts
        .filter((c: { name?: string }) => c.name && typeof c.name === 'string')
        .map((c: { name: string; role?: string; email?: string; relationship_type?: string }) => ({
          org_id: org.id,
          name: c.name.trim(),
          role: c.role || null,
          email: c.email || null,
          relationship_type: c.relationship_type || null,
        }));

      if (contactRows.length > 0) {
        const { data: contactData, error: contactError } = await supabase
          .from('contacts')
          .insert(contactRows)
          .select();

        if (contactError) {
          // Org was created but contacts failed — return org with warning
          return NextResponse.json(
            { ...org, contacts: [], _warning: contactError.message },
            { status: 201 }
          );
        }
        createdContacts = contactData || [];
      }
    }

    return NextResponse.json({ ...org, contacts: createdContacts }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
