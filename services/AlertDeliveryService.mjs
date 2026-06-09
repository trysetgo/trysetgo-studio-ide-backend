import { supabaseProjectRepository } from "../repositories/supabaseProjectRepository.mjs";

export class AlertDeliveryService {
  async listChannels(projectId) {
    if (!supabaseProjectRepository.isConfigured()) {
      return [];
    }

    return supabaseProjectRepository.supabaseRequest(
      `alert_channels?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=created_at.desc`
    );
  }

  async deliver({ projectId, alert }) {
    const channels = await this.listChannels(projectId);
    const results = [];

    for (const channel of channels.filter((item) => item.enabled !== false)) {
      if (channel.type === "webhook" && channel.config?.url) {
        results.push(await this.sendWebhook(channel, alert));
      } else {
        results.push({
          channelId: channel.id,
          status: "skipped",
          reason: `${channel.type} delivery is registered but not active in this environment.`
        });
      }
    }

    return results;
  }

  async sendWebhook(channel, alert) {
    try {
      const response = await fetch(channel.config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(channel.config.headers ?? {})
        },
        body: JSON.stringify({ alert, channel: channel.name })
      });
      return {
        channelId: channel.id,
        status: response.ok ? "sent" : "failed",
        statusCode: response.status
      };
    } catch (error) {
      return {
        channelId: channel.id,
        status: "failed",
        reason: error instanceof Error ? error.message : "Webhook delivery failed."
      };
    }
  }
}

export const alertDeliveryService = new AlertDeliveryService();
