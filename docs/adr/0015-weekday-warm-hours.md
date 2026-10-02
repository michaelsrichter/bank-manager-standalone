# ADR 0015: Keep one replica warm on weekday working hours

- Status: accepted
- Date: 2026-10-02
- Context: The web app scales to zero about 5 minutes after the last request
  (`minReplicas: 0`, from the eps-demo-cost-security skill). The next visitor
  then waits for Azure to place a new replica. On 2026-10-02 we measured about
  **30 seconds** from the first request to the first page. Almost all of it was
  the platform scheduling the replica (2–23 s in recent starts). The app itself
  was ready about 1 second after its container started, so making the app
  faster would not help.

  | Option | Est. USD/month (eastus2, 0.5 vCPU / 1 GiB) | Result |
  |---|---|---|
  | Scale to zero (before) | ~0 (free grant) | ~30 s wait after every quiet spell |
  | One replica warm Mon–Fri, 8 AM–8 PM US Eastern | ~3 | Fast during working hours |
  | `minReplicas: 1` all the time | ~10–11 | Always fast |

  A warm replica that is not handling requests is billed at the idle rate
  ($0.000003 per vCPU-second and per GiB-second). This is the only Container
  App in the subscription, so the monthly free grant (180,000 vCPU-s and
  360,000 GiB-s) applies in full.
- Decision: Keep `minReplicas: 0` and add a KEDA **cron** scale rule that holds
  one replica on weekdays from 8 AM to 8 PM `America/New_York`. The HTTP rule
  still adds a second replica under load. Set `WARM_HOURS_ENABLED=false` in the
  azd environment to remove the rule and go back to pure scale to zero.
- Consequences:
  - Good: no cold start during the hours people are likely to try the demo or
    present it. The app still scales to zero at night and on weekends.
  - Bad: about USD 3/month more. Visitors at night and on weekends still wait
    about 30 seconds. For an evening or weekend talk, open the site 5 minutes
    early (the presenter checklist already says so), or set `minReplicas: 1`
    for that day.
