-- Update existing templates to include accommodation placeholder

UPDATE email_templates 
SET html_content = '<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Festival Invitation</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">🎬 Festival Invitation</h1>
  </div>
  
  <div style="background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
    <h2 style="color: #667eea; margin-top: 0;">You''re Invited to {{edition_name}}!</h2>
    
    <p style="font-size: 16px;">Dear <strong>{{guest_name}}</strong>,</p>
    
    <p style="font-size: 16px;">We are excited to invite you to participate in <strong>{{edition_name}}</strong> as a <strong style="color: #667eea;">{{category}}</strong>.</p>
    
    {{accommodation_info}}
    
    <div style="background: #f8f9ff; padding: 20px; border-radius: 8px; margin: 25px 0;">
      <p style="margin: 0; font-size: 16px;">Please confirm your attendance by clicking the button below:</p>
    </div>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="{{confirmation_url}}" 
         style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                color: white; 
                padding: 15px 30px; 
                text-decoration: none; 
                border-radius: 25px; 
                font-weight: bold; 
                font-size: 16px;
                display: inline-block;
                transition: transform 0.2s;">
        ✓ Confirm Attendance
      </a>
    </div>
    
    <p style="font-size: 14px; color: #666; border-top: 1px solid #eee; padding-top: 20px;">
      <strong>Can''t click the button?</strong> Copy and paste this link into your browser:<br>
      <span style="background: #f1f1f1; padding: 5px; border-radius: 3px; word-break: break-all;">{{confirmation_url}}</span>
    </p>
    
    <p style="font-size: 16px; margin-top: 30px;">We look forward to your participation!</p>
    
    <p style="font-size: 16px; margin-bottom: 0;">
      Best regards,<br>
      <strong>The Festival Team</strong>
    </p>
  </div>
</body>
</html>',
updated_at = CURRENT_TIMESTAMP
WHERE language = 'english';

UPDATE email_templates 
SET html_content = '<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pozvánka na festival</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">🎬 Pozvánka na festival</h1>
  </div>
  
  <div style="background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
    <h2 style="color: #667eea; margin-top: 0;">Jste zváni na {{edition_name}}!</h2>
    
    <p style="font-size: 16px;">Vážený/-á <strong>{{guest_name}}</strong>,</p>
    
    <p style="font-size: 16px;">S radostí Vás zveme k účasti na <strong>{{edition_name}}</strong> jako <strong style="color: #667eea;">{{category}}</strong>.</p>
    
    {{accommodation_info}}
    
    <div style="background: #f8f9ff; padding: 20px; border-radius: 8px; margin: 25px 0;">
      <p style="margin: 0; font-size: 16px;">Prosím, potvrďte svou účast kliknutím na tlačítko níže:</p>
    </div>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="{{confirmation_url}}" 
         style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                color: white; 
                padding: 15px 30px; 
                text-decoration: none; 
                border-radius: 25px; 
                font-weight: bold; 
                font-size: 16px;
                display: inline-block;
                transition: transform 0.2s;">
        ✓ Potvrdit účast
      </a>
    </div>
    
    <p style="font-size: 14px; color: #666; border-top: 1px solid #eee; padding-top: 20px;">
      <strong>Tlačítko nefunguje?</strong> Zkopírujte a vložte tento odkaz do prohlížeče:<br>
      <span style="background: #f1f1f1; padding: 5px; border-radius: 3px; word-break: break-all;">{{confirmation_url}}</span>
    </p>
    
    <p style="font-size: 16px; margin-top: 30px;">Těšíme se na Vaši účast!</p>
    
    <p style="font-size: 16px; margin-bottom: 0;">
      S pozdravem,<br>
      <strong>Tým festivalu</strong>
    </p>
  </div>
</body>
</html>',
updated_at = CURRENT_TIMESTAMP
WHERE language = 'czech';