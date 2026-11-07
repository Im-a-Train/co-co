//! Token refresh scheduling, mirroring the eCamp Vue frontend
//! (`frontend/src/plugins/auth.js`): refresh at half the remaining JWT
//! lifetime, clamped to 2..30 minutes.

pub const MIN_REFRESH_DELAY_SECS: i64 = 2 * 60;
pub const MAX_REFRESH_DELAY_SECS: i64 = 30 * 60;

/// Seconds until the next refresh, given the JWT `exp` and `now` (both seconds).
/// Unknown or past expiry yields the minimum delay.
pub fn refresh_delay_secs(exp: Option<i64>, now: i64) -> i64 {
    let remaining = exp.map(|e| e.saturating_sub(now)).unwrap_or(0);
    (remaining / 2).clamp(MIN_REFRESH_DELAY_SECS, MAX_REFRESH_DELAY_SECS)
}

/// Current Unix time in seconds.
pub fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn half_remaining_lifetime() {
        assert_eq!(refresh_delay_secs(Some(1000 + 20 * 60), 1000), 10 * 60);
    }

    #[test]
    fn clamps() {
        assert_eq!(refresh_delay_secs(Some(1000 + 12 * 3600), 1000), MAX_REFRESH_DELAY_SECS);
        assert_eq!(refresh_delay_secs(Some(1000 + 60), 1000), MIN_REFRESH_DELAY_SECS);
        assert_eq!(refresh_delay_secs(Some(10), 1000), MIN_REFRESH_DELAY_SECS);
        assert_eq!(refresh_delay_secs(None, 1000), MIN_REFRESH_DELAY_SECS);
        assert_eq!(refresh_delay_secs(Some(i64::MIN), i64::MAX), MIN_REFRESH_DELAY_SECS);
    }

    #[test]
    fn now_is_sane() {
        assert!(now_secs() > 1_700_000_000);
    }
}
