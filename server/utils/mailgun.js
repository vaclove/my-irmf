const formData = require('form-data');
const Mailgun = require('mailgun.js');

class MailgunService {
  constructor() {
    this.mailgun = new Mailgun(formData);
    this.mg = null;
    this.domain = process.env.MAILGUN_DOMAIN;
    this.fromEmail = process.env.MAILGUN_FROM_EMAIL;
    
    if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
      this.mg = this.mailgun.client({
        username: 'api',
        key: process.env.MAILGUN_API_KEY,
        url: 'https://api.eu.mailgun.net'
      });
    }
  }

  async sendEmail({ to, subject, html, text }) {
    if (!this.mg) {
      throw new Error('Mailgun not configured. Please set MAILGUN_API_KEY and MAILGUN_DOMAIN');
    }

    try {
      // In non-production environments, redirect all emails to vaclav@irmf.cz
      let actualTo = to;
      let actualSubject = subject;
      
      if (process.env.NODE_ENV !== 'production') {
        const originalTo = Array.isArray(to) ? to.join(', ') : to;
        actualTo = 'vaclav@irmf.cz';
        actualSubject = `[DEV - Original: ${originalTo}] ${subject}`;
      }

      const messageData = {
        from: this.fromEmail,
        to: actualTo,
        subject: actualSubject,
        html: html,
        text: text || this.stripHtml(html)
      };

      console.log(`Sending email: ${actualTo} (original: ${to}) - ${actualSubject}`);
      const response = await this.mg.messages.create(this.domain, messageData);
      return response;
    } catch (error) {
      console.error('Mailgun error:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  stripHtml(html) {
    return html.replace(/<[^>]*>/g, '');
  }

  isConfigured() {
    return !!(this.mg && this.domain && this.fromEmail);
  }
}

module.exports = new MailgunService();