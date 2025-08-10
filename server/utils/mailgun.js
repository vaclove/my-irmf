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

  async sendEmail({ to, cc, subject, html, text }) {
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

      // Add CC if provided (only in production, in dev all emails go to vaclav@irmf.cz anyway)
      if (cc && process.env.NODE_ENV === 'production') {
        messageData.cc = cc;
      }

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

  async getStats() {
    if (!this.mg) {
      throw new Error('Mailgun not configured');
    }

    try {
      console.log('Fetching Mailgun stats for domain:', this.domain);
      
      // Use the correct Mailgun stats API
      const response = await this.mg.stats.getDomain(this.domain, {
        event: 'accepted',
        duration: '1d',
        resolution: 'day'
      });
      
      console.log('Mailgun stats response:', JSON.stringify(response, null, 2));
      
      // Parse the response correctly
      let totalSent = 0;
      
      if (response && response.stats && Array.isArray(response.stats)) {
        // Sum all accepted emails from stats
        totalSent = response.stats.reduce((sum, stat) => {
          // accepted is an object with outgoing, incoming, total properties
          if (stat.accepted && typeof stat.accepted === 'object') {
            return sum + (stat.accepted.outgoing || 0);
          }
          return sum;
        }, 0);
      }

      const dailyLimit = 100;

      return {
        totalSent,
        dailyLimit,
        remaining: Math.max(0, dailyLimit - totalSent),
        percentageUsed: Math.min(100, (totalSent / dailyLimit) * 100)
      };
    } catch (error) {
      console.error('Mailgun stats error:', error);
      throw error;
    }
  }

  isConfigured() {
    return !!(this.mg && this.domain && this.fromEmail);
  }
}

module.exports = new MailgunService();