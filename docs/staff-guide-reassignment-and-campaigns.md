# Staff guide: reassigning leads, and WhatsApp campaigns

Written for the people using the CRM, not for engineers. Two topics, because both were
asked about together: changing who owns a lead, and sending a WhatsApp campaign.

---

## Part 1. Changing who owns a lead

### The short version

Open the lead, pick a name under **Owner**, click **Save owner**. That is the whole job.

### Where the control is

Lead detail drawer, in the **Owner** section. It used to be labelled "Reassign to" while
already showing the current owner's name, which is why it was confusing: you could not tell
whether the name in the box was who owns the lead now, or who you were about to give it to.

It now reads plainly:

- The section heading is **Owner**.
- The box shows **the person who owns the lead right now**.
- The button says **Save owner**, and it only lights up once you have picked someone
  different. If it looks greyed out, the line underneath tells you why ("This is already the
  owner, pick someone else to change it"). The button is not broken.

### Who you can assign to

Only active **counsellors** and **marketing** staff. Students, faculty and everyone else are
filtered out by the server, so you cannot hand a lead to someone who cannot work it. Each
name shows their role and how many open leads they are already carrying, like
`Priya Sharma - counsellor - 12 open`, so you can spread load without leaving the screen.

If your team is large (8 or more assignable people) a **search box** appears at the top of the
list. Type any part of a name or email. Below 8 people there is no search box, because
scanning a short list is faster than typing.

### Unassigning

Pick **Unassigned** in the same box and save. The lead stays where it is, it just has no
owner. Nobody is notified on an unassign.

### The Reason box

Under the picker there is an optional **Reason**. Use it when the handover needs explaining
("Priya on leave until the 20th", "escalating to senior counsellor"). It is optional, and
skipping it is fine for routine handovers.

### What happens after you save

Four things, in this order:

1. The lead's owner changes.
2. The new owner gets a **notification in the CRM**. The previous owner is not notified.
3. A line appears in the lead's **Activity** tab: `Owner changed from A to B. Reason: ...`.
   This is the record. Anyone opening the lead later can see the handover happened and why.
4. You get a confirmation toast.

Important: a reassignment does **not** count as contacting the lead. It will not affect the
"first response time" figure on the per-rep report. Moving leads around cannot flatter your
response numbers.

### Reassigning many leads at once

In the leads **table** view (not the kanban board):

1. Tick the leads you want.
2. Use the **Assign to** picker in the toolbar that appears.
3. Click **Assign**.
4. A confirmation box appears first, telling you how many leads are moving and that the new
   owner will be notified. Read it, then confirm.

The confirmation step is deliberate. Bulk assign can move fifty leads and fire fifty
notifications in one click, so it asks first. Single-lead claiming of an unassigned lead does
not ask, because there is nothing to undo.

Bulk assign needs the `bulk.leads` permission and is only in table view. If you are on the
kanban board, switch to table.

### If something goes wrong

Every failure shows an error toast. Nothing fails silently. If a bulk assign partly succeeds
you get a count of how many worked ("42 of 50 leads updated"), not a false all-clear.

There is no undo button. To reverse a reassignment, pick the original owner and save again.

---

## Part 2. WhatsApp campaigns

### Read this first: current status

**WhatsApp campaign sending is not working yet, and you should not rely on it.** The screens
exist and will let you build and send a campaign, but the messages will be rejected by Meta.
This section explains what is built, what is missing, and what has to happen before it works.
It is written now so the setup is understood when the remaining work is done.

Email campaigns are a separate thing and are unaffected by this.

### What already works

- WhatsApp is a real channel in the campaign builder. You can pick it.
- The connection to Meta's WhatsApp Cloud API is built, including sending template messages
  and verifying delivery receipts.
- Audience selection, scheduling, per recipient tracking (queued / sent / delivered / read /
  failed) and the results dashboard are all built and correct.
- Consent is enforced at the database level and cannot be bypassed. Only leads and students
  who have opted in to marketing will ever receive a campaign. This is not a setting anyone
  can switch off.

### What is missing (three things, all small but all fatal)

1. **The template name sent to Meta is the wrong one.** The system sends the friendly name
   you typed in the CRM ("October Admission Reminder"). Meta needs the exact approved
   template name (`october_admission_reminder`). There is currently nowhere in the CRM to
   record that second name.
2. **Variables are not sent.** If your approved template has placeholders, they arrive empty
   and Meta rejects the message.
3. **Language is always assumed to be English.** A template approved as Hindi or Telugu will
   not be found.

There is also no automatic sender for **scheduled** campaigns. A campaign set to "schedule
for later" will sit there until somebody opens it and clicks Send. Send-now works.

### The thing most people get wrong about WhatsApp

You cannot write a WhatsApp marketing message and send it. Meta does not allow it.

Every message sent to someone who has not messaged you recently must use a **template that
Meta has already reviewed and approved**. You create and submit templates in **Meta Business
Manager**, not in this CRM. Approval takes anywhere from a few minutes to a day or two.

This has a consequence that confuses people: for a WhatsApp campaign, **the message body you
type into the CRM is not what gets sent**. Meta already has the wording. The body in the CRM
only exists to define the order of the variables. Editing it will not change the message the
recipient sees. Only editing and re-submitting the template in Meta Business Manager does
that.

### How it will work, once finished

1. Write your message in Meta Business Manager as a template. Submit it. Wait for approval.
2. Note the exact template name and the language it was approved in.
3. In the CRM, go to **Marketing > Campaigns > Templates** and create a template. Set the
   channel to WhatsApp, and record the Meta template name and language exactly as approved.
4. Build the campaign: choose your audience, pick the template, preview, then send or
   schedule.
5. Watch results on the campaign detail screen. Delivered and read receipts flow back from
   Meta automatically.

### Setup still needed on the server

WhatsApp is currently switched off in production (`WHATSAPP_PROVIDER=disabled`). Turning it
on needs credentials from Meta Business Manager: the phone number ID, an access token, the
app secret, and a verify token. Until those are set, nothing sends regardless of what the
screens allow.

---

## Related

- Lead ownership design and the per-rep report: `docs/specs/lead-ownership-accountability.md`
- Live production issues and their status: `docs/live-issues.md`
