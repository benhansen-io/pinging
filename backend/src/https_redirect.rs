use std::{convert::TryFrom, net::SocketAddr};

use axum::{
    extract::Host,
    http::{uri::Authority, StatusCode, Uri},
    response::Redirect,
    routing::get,
    Router,
};
use tracing::error;

/// Launch a trivial server listening to HTTP to redirect to HTTPS.
///
/// Must be called from a tokio runtime context.
pub fn launch_redirect_to_https_server(addr: SocketAddr) {
    let app = Router::new()
        .route("/", get(redirect_handler))
        .route("/*path", get(redirect_handler));
    let _ = tokio::spawn(async move {
        axum_server::bind(addr)
            .http_config(super::get_http_config())
            .serve(app.into_make_service())
            .await
    });
}

async fn redirect_handler(uri: Uri, host: Host) -> Result<Redirect, (StatusCode, &'static str)> {
    let mut parts = uri.clone().into_parts();
    parts.scheme = Some(axum::http::uri::Scheme::HTTPS);
    if parts.authority.is_none() {
        // This might not work for hosts with a port but that is not expected in production.
        parts.authority = Some(Authority::try_from(host.0).map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                "Host given not convertible to Authority",
            )
        })?);
    }
    match Uri::from_parts(parts) {
        Ok(uri) => Ok(Redirect::permanent(&uri.to_string())),
        Err(e) => {
            error!("Failed to create redirect from {}: {}", uri, e);
            Err((StatusCode::INTERNAL_SERVER_ERROR, "Failed to redirect"))
        }
    }
}
