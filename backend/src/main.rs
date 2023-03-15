use anyhow::{bail, Context};
use axum::{
    error_handling::HandleErrorLayer,
    extract::{DefaultBodyLimit, Extension, Host, OriginalUri},
    handler::Handler,
    http::{header, HeaderValue, Method, StatusCode},
    middleware,
    routing::{get, post},
    BoxError, Router,
};
use axum_server::HttpConfig;
use std::{net::SocketAddr, time::Duration};
use tower_http::set_header::SetResponseHeaderLayer;
use tracing::info;

mod https_redirect;
mod metrics;
mod static_files;
mod webrtc;
mod www_redirect;

/// Use environment variables for configuration
fn get_req_env_var(name: &str) -> anyhow::Result<String> {
    std::env::var(name).with_context(|| format!("required env variable '{}' not set", name))
}

/// Not needed values must be explicitly set to None
fn get_opt_env_var(name: &str) -> anyhow::Result<Option<String>> {
    let value = get_req_env_var(name)?;
    if value == "None" {
        Ok(None)
    } else {
        Ok(Some(value))
    }
}

/// Return the client generated random number that is prefixed to the host.
async fn dns_check(OriginalUri(original_uri): OriginalUri, host: Host) -> String {
    let mut host = original_uri.host().unwrap_or(&host.0).to_owned();
    if let Some(pos) = host.find("dns-check") {
        host.truncate(pos);
    }
    host
}

/// HTTP ping
async fn ping(data: String) -> String {
    data
}

fn log_env_variables() {
    for (key, value) in std::env::vars_os() {
        if let Some(key) = key.to_str() {
            if key.starts_with("PINGING_") {
                info!("Env: {} => {:?}", key, value);
            }
        }
    }
}

fn get_http_config() -> HttpConfig {
    axum_server::HttpConfig::new()
        .http1_header_read_timeout(Duration::from_secs(10))
        .build()
}

async fn handle_timeout_error(err: BoxError) -> (StatusCode, String) {
    if err.is::<tower::timeout::error::Elapsed>() {
        (
            StatusCode::REQUEST_TIMEOUT,
            "Request took too long".to_string(),
        )
    } else {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Unhandled internal error: {}", err),
        )
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    env_logger::init();

    info!(concat!("Repo git hash: ", env!("GIT_HASH")));
    log_env_variables();

    let public_webrtc_addr: std::net::SocketAddr = get_req_env_var("PINGING_PUBLIC_WEBRTC_ADDR")?
        .parse()
        .context("failed to parse PINGING_PUBLIC_WEBRTC_ADDR")?;

    let location_description = get_req_env_var("PINGING_LOCATION_DESCRIPTION")?;

    let webrtc_session_endpoint =
        webrtc::launch_and_run_webrtc(public_webrtc_addr, location_description)
            .await
            .context("failed to spawn webrtc server")?;

    let redirect_addr = get_opt_env_var("PINGING_REDIRECT_TO_HTTPS_SOCKET_ADDR")?;
    if let Some(redirect_addr) = redirect_addr {
        let redirect_addr: SocketAddr = redirect_addr.parse().with_context(|| {
            format!(
                "Failed to parse PINGING_REDIRECT_TO_HTTPS_SOCKET_ADDR: {}",
                redirect_addr
            )
        })?;
        https_redirect::launch_redirect_to_https_server(redirect_addr);
    }

    let main_addr = get_req_env_var("PINGING_MAIN_SOCKET_ADDR")?;
    let main_addr: SocketAddr = main_addr
        .parse()
        .with_context(|| format!("Failed to parse PINGING_MAIN_SOCKET_ADDR: {}", main_addr))?;

    let public_dir = get_req_env_var("PINGING_PUBLIC_DIR")?;

    let allow_any_origin = tower_http::cors::CorsLayer::new()
        .allow_origin(tower_http::cors::Any {})
        .allow_methods(vec![Method::GET]);

    let metrics_recorder = metrics::setup_metrics_recorder();

    let app = Router::new()
        .route("/new_rtc_session", post(webrtc::new_rtc_session))
        .route("/api/ping", get(ping).post(ping))
        .route("/api/dns-check", get(dns_check.layer(allow_any_origin)))
        .route(
            "/metrics",
            get(move || std::future::ready(metrics_recorder.render())),
        )
        .fallback_service(static_files::get_static_file_service(&public_dir))
        .layer(
            tower::builder::ServiceBuilder::new()
                .layer(HandleErrorLayer::new(handle_timeout_error))
                .timeout(Duration::from_secs(30))
                .layer(middleware::from_fn(metrics::track_metrics))
                .layer(DefaultBodyLimit::max(1024))
                .layer(Extension(webrtc_session_endpoint))
                .layer(SetResponseHeaderLayer::overriding(
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("no-store, max-age=0, must-revalidate"),
                ))
                .layer(SetResponseHeaderLayer::overriding(
                    header::EXPIRES,
                    HeaderValue::from_static("0"),
                ))
                .layer(SetResponseHeaderLayer::overriding(
                    header::PRAGMA,
                    HeaderValue::from_static("no-cache"),
                ))
                .layer(middleware::from_fn(
                    www_redirect::redirect_to_www_middleware_fn,
                )),
        );

    let tls_cert = get_opt_env_var("PINGING_TLS_CERT")?;
    let tls_key = get_opt_env_var("PINGING_TLS_KEY")?;
    let main_join_handle = match (tls_cert, tls_key) {
        (Some(tls_cert), Some(tls_key)) => {
            let config = axum_server::tls_rustls::RustlsConfig::from_pem_file(tls_cert, tls_key)
                .await
                .context("failed to loading tls from pem file")?;
            tokio::spawn(
                axum_server::bind_rustls(main_addr, config)
                    .http_config(get_http_config())
                    .serve(app.into_make_service()),
            )
        }
        (None, None) => tokio::spawn(
            axum_server::bind(main_addr)
                .http_config(get_http_config())
                .serve(app.into_make_service()),
        ),
        _ => {
            bail!("One of PINGING_TLS_CERT or PINGING_TLS_KEY specified but not the other.");
        }
    };

    main_join_handle
        .await
        .context("failed to join main server spawn")?
        .context("main server error")
}
