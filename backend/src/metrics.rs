use axum::{http::Request, middleware::Next, response::IntoResponse};
use metrics_exporter_prometheus::{Matcher, PrometheusBuilder, PrometheusHandle};
use metrics_process::Collector;

pub fn setup_metrics_recorder() -> PrometheusHandle {
    std::thread::Builder::new()
        .name("metrics_process".to_owned())
        .spawn(|| {
            let collector = Collector::default();
            collector.describe();
            loop {
                collector.collect();
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        })
        .unwrap();

    const EXPONENTIAL_SECONDS: &[f64] = &[
        0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
    ];

    PrometheusBuilder::new()
        .set_buckets_for_metric(
            Matcher::Full("http_requests_duration_seconds".to_string()),
            EXPONENTIAL_SECONDS,
        )
        .unwrap()
        .install_recorder()
        .unwrap()
}

pub async fn track_metrics<B>(req: Request<B>, next: Next<B>) -> impl IntoResponse {
    let start = std::time::Instant::now();
    let mut path = if let Some(matched_path) = req.extensions().get::<axum::extract::MatchedPath>()
    {
        matched_path.as_str().to_owned()
    } else {
        req.uri().path().to_owned()
    };
    let method = req.method().clone();

    let response = next.run(req).await;

    let latency = start.elapsed().as_secs_f64();
    let status = response.status().as_u16().to_string();

    if status == "404" || status == "405" {
        // Do not record 404 or 405 paths as metrics so they do not take up memory (and bandwidth when exporting metrics).
        path = "REDACTED".to_owned();
    }

    let labels = [
        ("method", method.to_string()),
        ("path", path),
        ("status", status),
    ];

    metrics::increment_counter!("http_requests_total", &labels);
    metrics::histogram!("http_requests_duration_seconds", latency, &labels);

    response
}
