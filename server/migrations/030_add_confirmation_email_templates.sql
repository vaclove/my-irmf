-- Description: Add support for confirmation email templates
-- This migration adds template_type column to email_templates and creates confirmation email templates

BEGIN;

-- Add template_type column to email_templates (if it doesn't exist)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'email_templates' 
        AND column_name = 'template_type'
    ) THEN
        ALTER TABLE email_templates 
        ADD COLUMN template_type VARCHAR(50) DEFAULT 'invitation';
    END IF;
END $$;

-- Update existing templates to be invitation type
UPDATE email_templates SET template_type = 'invitation' WHERE template_type IS NULL;

-- Drop old unique constraint that only considered edition_id and language
-- First try dropping as constraint, then as index
DO $$ 
BEGIN
    -- Try to drop as constraint first
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'email_templates_edition_language_unique'
        AND table_name = 'email_templates'
    ) THEN
        ALTER TABLE email_templates DROP CONSTRAINT email_templates_edition_language_unique;
    END IF;
    
    -- Then drop as index if it exists
    IF EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'email_templates_edition_language_unique'
    ) THEN
        DROP INDEX email_templates_edition_language_unique;
    END IF;
END $$;

-- Create new unique constraint that includes template_type (if it doesn't exist)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'email_templates_edition_language_type_unique'
    ) THEN
        CREATE UNIQUE INDEX email_templates_edition_language_type_unique 
        ON email_templates(edition_id, language, template_type);
    END IF;
END $$;

-- Insert confirmation email templates for English and Czech (only if they don't exist)
-- We'll use the existing edition (assuming there's one with the templates)
WITH template_edition AS (
    SELECT DISTINCT edition_id FROM email_templates LIMIT 1
)
INSERT INTO email_templates (
    name, 
    subject, 
    body, 
    language, 
    template_type, 
    edition_id,
    markdown_content
) 
SELECT 
    'confirmation_english',
    'Thank you for confirming your attendance - {{edition_name}}',
    'Thank you for confirming your attendance at {{edition_name}}!

We are delighted that you will be joining us as a {{category}}.

Your confirmation details:
- Guest: {{guest_name}}
- Event: {{edition_name}}
- Category: {{category}}
- Confirmed at: {{confirmed_at}}
{{#if accommodation_dates}}
- Accommodation confirmed for: {{accommodation_dates}}
{{/if}}

We will be in touch closer to the event with more details about the festival schedule, venue information, and what to expect.

If you have any questions in the meantime, please don''t hesitate to contact us at irmf@irmf.cz.

Looking forward to seeing you at the festival!

Best regards,
International Road Movie Festival Team',
    'english'::guest_language,
    'confirmation',
    te.edition_id,
    '{{greeting}}

Thank you for confirming your attendance at **{{edition_name}}**!

We are delighted that you will be joining us as a **{{category}}**.

## Your confirmation details:
- **Guest:** {{guest_name}}
- **Event:** {{edition_name}}
- **Category:** {{category}}
- **Confirmed at:** {{confirmed_at}}
{{#if accommodation_dates}}
- **Accommodation confirmed for:** {{accommodation_dates}}
{{/if}}

We will be in touch closer to the event with more details about the festival schedule, venue information, and what to expect.

If you have any questions in the meantime, please don''t hesitate to contact us at **irmf@irmf.cz**.

Looking forward to seeing you at the festival!

Best regards,  
**International Road Movie Festival Team**'
FROM template_edition te

UNION ALL

SELECT 
    'confirmation_czech',
    'Děkujeme za potvrzení účasti - {{edition_name}}',
    'Děkujeme za potvrzení vaší účasti na {{edition_name}}!

Jsme rádi, že se k nám připojíte jako {{category}}.

Vaše potvrzení:
- Host: {{guest_name}}
- Akce: {{edition_name}}
- Kategorie: {{category}}
- Potvrzeno: {{confirmed_at}}
{{#if accommodation_dates}}
- Ubytování potvrzeno pro: {{accommodation_dates}}
{{/if}}

Budeme vás kontaktovat před akcí s dalšími informacemi o programu festivalu, místě konání a o tom, co můžete očekávat.

Pokud máte mezitím jakékoliv otázky, neváhejte nás kontaktovat na irmf@irmf.cz.

Těšíme se na setkání na festivalu!

S pozdravem,
Tým International Road Movie Festival',
    'czech'::guest_language,
    'confirmation',
    te.edition_id,
    '{{greeting}}

Děkujeme za potvrzení vaší účasti na **{{edition_name}}**!

Jsme rádi, že se k nám připojíte jako **{{category}}**.

## Vaše potvrzení:
- **Host:** {{guest_name}}
- **Akce:** {{edition_name}}
- **Kategorie:** {{category}}
- **Potvrzeno:** {{confirmed_at}}
{{#if accommodation_dates}}
- **Ubytování potvrzeno pro:** {{accommodation_dates}}
{{/if}}

Budeme vás kontaktovat před akcí s dalšími informacemi o programu festivalu, místě konání a o tom, co můžete očekávat.

Pokud máte mezitím jakékoliv otázky, neváhejte nás kontaktovat na **irmf@irmf.cz**.

Těšíme se na setkání na festivalu!

S pozdravem,  
**Tým International Road Movie Festival**'
FROM template_edition te
ON CONFLICT (edition_id, language, template_type) DO NOTHING;

COMMIT;