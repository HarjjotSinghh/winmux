use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    pub terminal_id: String,
    pub title: String,
    pub body: String,
    pub source: String,
    pub timestamp: DateTime<Utc>,
    pub read: bool,
}

pub struct NotificationStore {
    notifications: Vec<Notification>,
    max_size: usize,
}

impl NotificationStore {
    pub fn new() -> Self {
        Self {
            notifications: Vec::new(),
            max_size: 500,
        }
    }

    pub fn add(&mut self, terminal_id: &str, title: &str, body: &str, source: &str) -> Notification {
        let notif = Notification {
            id: Uuid::new_v4().to_string(),
            terminal_id: terminal_id.to_string(),
            title: title.to_string(),
            body: body.to_string(),
            source: source.to_string(),
            timestamp: Utc::now(),
            read: false,
        };

        self.notifications.push(notif.clone());

        // Evict oldest if over capacity
        if self.notifications.len() > self.max_size {
            self.notifications.remove(0);
        }

        notif
    }

    pub fn list(&self) -> Vec<Notification> {
        self.notifications.clone()
    }

    #[allow(dead_code)]
    pub fn unread_count(&self) -> usize {
        self.notifications.iter().filter(|n| !n.read).count()
    }

    #[allow(dead_code)]
    pub fn unread_for_terminal(&self, terminal_id: &str) -> usize {
        self.notifications
            .iter()
            .filter(|n| !n.read && n.terminal_id == terminal_id)
            .count()
    }

    pub fn dismiss(&mut self, id: &str) {
        if let Some(notif) = self.notifications.iter_mut().find(|n| n.id == id) {
            notif.read = true;
        }
    }

    pub fn clear(&mut self) {
        self.notifications.clear();
    }

    #[allow(dead_code)]
    pub fn clear_for_terminal(&mut self, terminal_id: &str) {
        self.notifications.retain(|n| n.terminal_id != terminal_id);
    }
}
