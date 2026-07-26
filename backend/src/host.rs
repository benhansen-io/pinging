use axum::{
    extract::FromRequestParts,
    http::{header::HOST, request::Parts, StatusCode},
};

/// Extractor that resolves the host of the request.
///
/// Prefers the `Host` header (sent on HTTP/1.1) and falls back to the URI
/// authority, which is populated from the `:authority` pseudo-header on
/// HTTP/2 — clients are permitted to omit `Host` entirely in that case.
pub struct Host(pub String);

impl<S> FromRequestParts<S> for Host
where
    S: Send + Sync,
{
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        if let Some(host) = parts.headers.get(HOST).and_then(|host| host.to_str().ok()) {
            return Ok(Host(host.to_owned()));
        }

        if let Some(authority) = parts.uri.authority() {
            // Strip userinfo (`user@host`) if present, matching `Host` header semantics.
            let host = authority.as_str().rsplit('@').next().unwrap();
            return Ok(Host(host.to_owned()));
        }

        Err((StatusCode::BAD_REQUEST, "Host header was missing"))
    }
}
