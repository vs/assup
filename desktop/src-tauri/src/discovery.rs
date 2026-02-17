use std::time::Duration;

const PORTS: [u16; 2] = [3001, 3000];
const TIMEOUT: Duration = Duration::from_secs(2);

pub async fn discover_backend() -> Option<String> {
    for port in PORTS {
        let url = format!("http://localhost:{}", port);
        let health_url = format!("{}/api/health", url);

        match reqwest::Client::new()
            .get(&health_url)
            .timeout(TIMEOUT)
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {
                println!("Found backend at {}", url);
                return Some(url);
            }
            Ok(response) => {
                println!("Backend at {} returned status {}", url, response.status());
            }
            Err(e) => {
                println!("No backend at {}: {}", url, e);
            }
        }
    }
    None
}
