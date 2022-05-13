use axum::{
    body::Body,
    http::{Request, StatusCode, Uri},
    routing::{get_service, MethodRouter},
};
use std::path::PathBuf;
use tower::ServiceExt;
use tower_http::services::{ServeDir, ServeFile};
use tracing::error;

fn append_html<B>(mut req: Request<B>) -> Request<B> {
    let uri: Uri = format!("{}.html", req.uri())
        .parse()
        .unwrap_or_else(|_| req.uri().clone());
    *req.uri_mut() = uri;
    req
}

pub fn get_static_file_service(public_dir: &str) -> MethodRouter<Body> {
    let not_found_path: PathBuf = [public_dir, "not-found.html"].iter().collect();

    let fallback = ServeDir::new(public_dir)
        .append_index_html_on_directories(true)
        .precompressed_br()
        .precompressed_gzip()
        .not_found_service(ServeFile::new(not_found_path))
        .map_request(append_html);

    get_service(
        ServeDir::new(public_dir)
            .append_index_html_on_directories(true)
            .precompressed_br()
            .precompressed_gzip()
            .not_found_service(fallback),
    )
    .handle_error(|error: std::io::Error| async move {
        error!("Unhandled error in static file server: {}", error);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unhandled internal error in static file server.",
        )
    })
}
