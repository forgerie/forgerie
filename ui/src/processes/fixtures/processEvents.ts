// Real `<process_event>` messages, copied from Forgerie session files.
export const succeededXml = `<process_event type="lifecycle" kind="success" process_id="proc_2482" process_name="cpo-poc-build" status="exited">
  <summary>Process "cpo-poc-build" succeeded after 12s.</summary>
  <command>cd ~/code/cpo-poc &amp;&amp; npm ci &amp;&amp; npm run build</command>
  <exit_code>0</exit_code>
  <end_reason>exit</end_reason>
  <logs_hint>Use process output/logs for process proc_2482 to inspect recent output.</logs_hint>
</process_event>`;

export const failedXml = `<process_event type="lifecycle" kind="crash" process_id="proc_dd13" process_name="oe-preview" status="exited">
  <summary>Process "oe-preview" failed with exit code 127 after 0s.</summary>
  <command>cd /tmp/option-e-example &amp;&amp; ./node_modules/.bin/vite preview --port 4318</command>
  <exit_code>127</exit_code>
  <end_reason>exit</end_reason>
  <logs_hint>Use process output/logs for process proc_dd13 to inspect recent output.</logs_hint>
</process_event>`;

export const stoppedXml = `<process_event type="lifecycle" kind="killed" process_id="proc_e3f1" process_name="caliper-dev" status="killed">
  <summary>Process "caliper-dev" ended after receiving SIGTERM (15, termination request).</summary>
  <command>./scripts/caliper-dev.mjs</command>
  <exit_code>143</exit_code>
  <end_reason>signal</end_reason>
  <signal name="SIGTERM" number="15">termination request</signal>
  <logs_hint>Use process output/logs for process proc_e3f1 to inspect recent output.</logs_hint>
</process_event>`;

export const matchedXml = `<process_event type="log_match" kind="log_match" process_id="proc_e3f1" process_name="caliper-dev">
  <summary>Process "caliper-dev" matched log pattern "Local:" on stdout.</summary>
  <pattern mode="literal">Local:</pattern>
  <stream>stdout</stream>
  <matched_line>  ➜  Local:   http://localhost:5173/</matched_line>
</process_event>`;

/** 21:04 on 2026-10-08, in UTC. */
export const fixtureTime = 1791493440000;

export const failedLog = "> vite preview --port 4318\nsh: ./node_modules/.bin/vite: No such file or directory";
