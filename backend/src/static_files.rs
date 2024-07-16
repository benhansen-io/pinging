use axum::{
    body::Body,
    http::{Request, Uri},
    response::Response,
};
use futures::Future;
use std::{convert::Infallible, path::PathBuf};
use tower::{Service, ServiceExt};
use tower_http::services::{fs::ServeFileSystemResponseBody, ServeDir, ServeFile};

fn append_html(mut req: Request<Body>) -> Request<Body> {
    let uri: Uri = format!("{}.html", req.uri())
        .parse()
        .unwrap_or_else(|_| req.uri().clone());
    *req.uri_mut() = uri;
    req
}

pub fn get_static_file_service(
    public_dir: &str,
) -> impl Service<
    Request<Body>,
    Response = Response<ServeFileSystemResponseBody>,
    Error = Infallible,
    Future = impl Future<Output = Result<Response<ServeFileSystemResponseBody>, Infallible>> + Send,
> + Clone {
    let not_found_path: PathBuf = [public_dir, "not-found.html"].iter().collect();

    let fallback = ServeDir::new(public_dir)
        .append_index_html_on_directories(true)
        .precompressed_br()
        .precompressed_gzip()
        .not_found_service(ServeFile::new(not_found_path))
        .map_request(append_html);

    ServeDir::new(public_dir)
        .append_index_html_on_directories(true)
        .precompressed_br()
        .precompressed_gzip()
        .fallback(fallback)
}
