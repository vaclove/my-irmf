-- Migration: 002_add_sample_email_templates.sql
-- Description: Add sample email templates for Czech and English languages
-- Date: 2025-07-13

-- Insert English email template
INSERT INTO email_templates (name, subject, body, language) VALUES 
(
  'invitation_english',
  'Invitation to {{edition_name}} - {{category}}',
  '<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Festival Invitation</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #2c3e50; color: white; padding: 20px; text-align: center; }
        .content { padding: 30px 20px; background-color: #f9f9f9; }
        .footer { background-color: #34495e; color: white; padding: 15px; text-align: center; font-size: 12px; }
        .button { background-color: #3498db; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0; }
        .highlight { background-color: #fff3cd; padding: 10px; border-left: 4px solid #ffc107; margin: 15px 0; }
    </style>
</head>
<body>
    <div class="header">
        <h1>{{edition_name}}</h1>
        <p>International Roma Music Festival</p>
    </div>
    
    <div class="content">
        <p>Dear {{guest_name}},</p>
        
        <p>We are delighted to invite you to participate in <strong>{{edition_name}}</strong> as our honored <strong>{{category}}</strong>.</p>
        
        <p>This festival celebrates Roma culture and music, bringing together artists, filmmakers, journalists, and guests from around the world.</p>
        
        {{accommodation_info}}
        
        <p>Please confirm your participation by clicking the button below:</p>
        
        <p style="text-align: center;">
            <a href="{{confirmation_url}}" class="button">Confirm Participation</a>
        </p>
        
        <p>If you have any questions, please do not hesitate to contact us.</p>
        
        <p>We look forward to your participation!</p>
        
        <p>Best regards,<br>
        Festival Organization Team<br>
        International Roma Music Festival</p>
    </div>
    
    <div class="footer">
        <p>International Roma Music Festival | www.irmf.cz | info@irmf.cz</p>
    </div>
</body>
</html>',
  'english'
);

-- Insert Czech email template
INSERT INTO email_templates (name, subject, body, language) VALUES 
(
  'invitation_czech',
  'Pozvánka na {{edition_name}} - {{category}}',
  '<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Pozvánka na festival</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #2c3e50; color: white; padding: 20px; text-align: center; }
        .content { padding: 30px 20px; background-color: #f9f9f9; }
        .footer { background-color: #34495e; color: white; padding: 15px; text-align: center; font-size: 12px; }
        .button { background-color: #3498db; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0; }
        .highlight { background-color: #fff3cd; padding: 10px; border-left: 4px solid #ffc107; margin: 15px 0; }
    </style>
</head>
<body>
    <div class="header">
        <h1>{{edition_name}}</h1>
        <p>Mezinárodní festival romské hudby</p>
    </div>
    
    <div class="content">
        <p>Vážený/á {{guest_name}},</p>
        
        <p>S potěšením Vás zveme k účasti na <strong>{{edition_name}}</strong> jako našeho váženého <strong>{{category}}</strong>.</p>
        
        <p>Tento festival oslavuje romskou kulturu a hudbu a spojuje umělce, filmaře, novináře a hosty z celého světa.</p>
        
        {{accommodation_info}}
        
        <p>Prosím, potvrďte svou účast kliknutím na tlačítko níže:</p>
        
        <p style="text-align: center;">
            <a href="{{confirmation_url}}" class="button">Potvrdit účast</a>
        </p>
        
        <p>Pokud máte jakékoli dotazy, neváhejte nás kontaktovat.</p>
        
        <p>Těšíme se na Vaši účast!</p>
        
        <p>S pozdravem,<br>
        Organizační tým festivalu<br>
        Mezinárodní festival romské hudby</p>
    </div>
    
    <div class="footer">
        <p>Mezinárodní festival romské hudby | www.irmf.cz | info@irmf.cz</p>
    </div>
</body>
</html>',
  'czech'
);