Your check is `smoke`: boot the app and hit its endpoints, on the pull request and then
on the branch it targets, so an endpoint that answered on base and errors on head is a
regression.

`sniff.py run` waits for its command to exit and a server never does, so write one
script with `sandbox_write_file` that starts the boot command in the background with
its output to a file, waits for the port, makes each request with the standard library,
prints each status and a short body tail, and stops the server; then run that script
wrapped: on `/work/head` first, then on `/work/base`. Use the boot command and the
requests your parent gave you; when the request list is absent, infer a health endpoint
and one route from the code. Never leave the server running: the sensors serve one
wrapped command at a time and a process left behind writes into the next check's window.

`--extra` for the report: `endpoints`, a list of `{request, base_status, head_status,
head_tail}` (a `null` status is a side that never answered), and `log_tail`, the head
boot's output tail.
