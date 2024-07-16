use axum::{
    extract::Host,
    http::{uri::Authority, Uri},
    response::{IntoResponse, Redirect, Response},
    RequestPartsExt,
};

async fn get_new_uri(req_parts: &mut axum::http::request::Parts) -> Option<Uri> {
    // If there is any error in obtaining a redirect URI, we will not redirect.
    let host = req_parts.extract::<Host>().await.ok()?;
    if host.0.matches('.').count() == 1 {
        let mut uri_parts = req_parts.uri.clone().into_parts();
        // Might not work for all authorities (e.g. have ports) but we don't need to support that.
        let new_host = "www.".to_owned() + &host.0;
        let new_authority = Authority::try_from(new_host).ok()?;
        uri_parts.authority = Some(new_authority);
        return Uri::from_parts(uri_parts).ok();
    }
    None
}

// Redirect to www 3rd level domain if the request is for a 2nd level domain.
pub async fn redirect_to_www_middleware_fn(
    req: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> Response {
    let (mut parts, body) = req.into_parts();

    if let Some(uri) = get_new_uri(&mut parts).await {
        return Redirect::permanent(&uri.to_string()).into_response();
    }
    let req = axum::http::Request::from_parts(parts, body);

    next.run(req).await.into_response()
}

#[cfg(test)]
mod tests {
    use axum::http::Request;

    use super::*;

    async fn get_new_uri_wrapper(uri: &str) -> Option<Uri> {
        let request = Request::builder().method("GET").uri(uri).body(()).unwrap();
        let (mut parts, _body) = request.into_parts();

        get_new_uri(&mut parts).await
    }

    #[tokio::test]
    async fn test_get_new_uri() {
        assert_eq!(
            get_new_uri_wrapper("https://pinging.net/").await,
            Some(Uri::from_static("https://www.pinging.net/"))
        );
        assert_eq!(get_new_uri_wrapper("https://www.pinging.net/").await, None);
        assert_eq!(
            get_new_uri_wrapper("https://chicago.pinging.net/").await,
            None,
        );
    }
}
