# [Pinging.net](https://www.pinging.net)

Pinging.net quickly determines if you are online by running multiple tests. It then continues to
monitor your connection via repeated tests including a "web ping" every second to help identify
intermittent network issues.

## Project goals

- Reliable. Do not make the user guess if the website isn't loading because of their internet or if
  the website is down.
- Fast website. Do not make the user wait, even on a slow connection.
- Provide multiple tests that all work with just the browser.
- Possible to understand for non-technical users.
- Provide concise educational descriptions and links to learn more.
- Allow for hosting outside of pinging.net (e.g. on private clouds).

Non-goals (currently):

- Speed test. There are many websites that provide this and the hosting costs would increase
  dramatically.

## The Tests

### HTTP Test

Makes a HTTP POST request with a random string body and verifies it is returned properly. Caching of
the request is also explicitly disabled. This test is run every 30 seconds.

### DNS Test

A HTTP GET request to a [random-number]dns-check.pinging.net. Caching is explicitly disabled and the
random number part of the subdomain prevents common caching of the DNS lookup. This test is run
every 30 seconds.

### Web Ping

Every second a WebRTC message is sent and returned by the server. UDP is used for the underlying
transport mechanism so dropped messages are not transparently retried. Dropped packets will show up
as red squares.

### Browser Check

Web browsers report if they believe you are offline. If this check is failing it means you are
likely not connected to your WiFi, cellular connection or ethernet cord. This is a basic check and
it will often pass even if you are not connected. This check is continuously monitored by your
browser.

### Initial Load Check

Caching is disabled for this site so if this site loads it is a strong indication your internet is
working at the time of loading the site.

<!-- Please verify if changes to text should also be changed in about.html -->

## Architecture

The backend is a single binary written in Rust that handles static file serving, APIs (including
WebRTC), and www and https redirects. The frontend is static html and TypeScript. Pinging.net is
deployed to cheap virtual private servers in multiple data centers and a DNS load balancer
(currently CloudFlare) is used to route traffic to the closest server.

Since there is no protocol level (e.g. HTTP/WebRTC) load balancer or reverse proxy (e.g. no nginx),
deployments are done by spinning up a new server and switching the DNS load balancer to use the new
IP. The old IP is kept running for an hour to allow DNS caches to update and existing clients to
refresh to the new server.

## Building and Running

Ensure the following dependencies are installed:

- rust
- nodejs
- npm
- jq

Then run scripts/build (build only), scripts/run_locally (build and run locally), or scripts/deploy
(build then deploy to IP address).

Currently only Linux is tested. I am open to contributions to help with developing or running on
other platforms.

## Contributing

Contributions are welcome. Thanks in advance for your help.

## Acknowledgements

Thanks to all of the authors of the dependencies and utilities that made pinging possible.

## License and Copyright

Licensed under [Apache-2.0](http://www.apache.org/licenses/LICENSE-2.0). Copyrights are retained by
their contributors.
