import { NextResponse } from "next/server";
import {
  appBaseUrl,
  isOutlookAddinEnabled,
  outlookAddinId,
  OUTLOOK_PANEL_PATH,
} from "@/lib/outlook-addin";

// The Office Add-in manifest, templated from the deployment's own base URL.
//
// Classic XML with VersionOverrides rather than the newer unified JSON manifest:
// XML is what outlook.live.com (consumer accounts) and Outlook for Mac support
// today, and this add-in has to work everywhere Aziru supports Outlook.
//
// Served from a route rather than a static file because Outlook resolves every
// resource by absolute URL, so the host origin must be baked in at request time.
// Self-hosters get a correct manifest for their own domain with no editing.
//
// Two choices worth recording, kept here rather than as XML comments so they do
// not ship to Microsoft and to every user who inspects the manifest:
//
//   - The ribbon Action is ShowTaskpane, not ExecuteFunction. Signing in, quota
//     exhaustion and "not sorted yet" all need somewhere to be said, and a
//     headless function file has no UI to say them in. Doubly true now that the
//     pane is the full Aziru panel rather than a one-shot draft action.
//   - RequestedHeight is sized for that panel (classification, summary, draft),
//     not for the two lines the draft-only pane needed. SupportsPinning stays on:
//     a pinned pane follows the reader from conversation to conversation, which
//     the pane handles via Office.EventType.ItemChanged (see officeHost.ts).
//   - Permissions stay at ReadItem. Aziru reads the open conversation's id and
//     opens a reply form for the user to send themselves; it must never hold a
//     permission that would let it send or modify mail. The panel does not widen
//     this: everything it shows comes from Aziru's own API, keyed by that id.
//
// The Id is per-DEPLOYMENT, not a constant, and must never change once that
// deployment has published: Outlook keys installed add-ins by it, so a new Id
// reads as a different add-in and a shared Id makes two deployments mutually
// exclusive in one mailbox. See outlookAddinId() for how it is set.

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildManifest(base: string, addinId: string): string {
  const b = xmlEscape(base);
  const paneUrl = `${b}${OUTLOOK_PANEL_PATH}`;
  // The ribbon's own entry points: same pane, told to get straight to the
  // requested section. The draft button used to be the whole feature; it is now
  // one action inside the panel, but the deep links are kept because clicking a
  // ribbon button IS the request — making the user press a second button in the
  // pane asks twice. The comments button opens the pane with the team comment
  // section expanded and scrolled into view.
  const draftUrl = `${paneUrl}?focus=draft`;
  const commentsUrl = `${paneUrl}?focus=comments`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp
  xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0"
  xmlns:mailappor="http://schemas.microsoft.com/office/mailappversionoverrides/1.0"
  xsi:type="MailApp">
  <Id>${addinId}</Id>
  <Version>1.1.0.0</Version>
  <ProviderName>Aziru</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="Aziru" />
  <Description DefaultValue="See how Aziru sorted the conversation you are reading, move it, and draft a reply — without leaving Outlook. Aziru never sends email: you review and send." />
  <IconUrl DefaultValue="${b}/outlook/icon-64.png" />
  <HighResolutionIconUrl DefaultValue="${b}/outlook/icon-128.png" />
  <SupportUrl DefaultValue="${b}/settings" />
  <AppDomains>
    <AppDomain>${b}</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Mailbox" />
  </Hosts>
  <Requirements>
    <Sets>
      <Set Name="Mailbox" MinVersion="1.5" />
    </Sets>
  </Requirements>
  <FormSettings>
    <Form xsi:type="ItemRead">
      <DesktopSettings>
        <SourceLocation DefaultValue="${paneUrl}" />
        <RequestedHeight>450</RequestedHeight>
      </DesktopSettings>
    </Form>
  </FormSettings>
  <Permissions>ReadItem</Permissions>
  <Rule xsi:type="RuleCollection" Mode="Or">
    <Rule xsi:type="ItemIs" ItemType="Message" FormType="Read" />
  </Rule>
  <DisableEntityHighlighting>false</DisableEntityHighlighting>

  <VersionOverrides xmlns="http://schemas.microsoft.com/office/mailappversionoverrides" xsi:type="VersionOverridesV1_0">
    <Requirements>
      <bt:Sets DefaultMinVersion="1.5">
        <bt:Set Name="Mailbox" />
      </bt:Sets>
    </Requirements>
    <Hosts>
      <Host xsi:type="MailHost">
        <DesktopFormFactor>
          <ExtensionPoint xsi:type="MessageReadCommandSurface">
            <OfficeTab id="TabDefault">
              <Group id="amarnaiGroup">
                <Label resid="groupLabel" />
                <Control xsi:type="Button" id="amarnaiPanelButton">
                  <Label resid="panelLabel" />
                  <Supertip>
                    <Title resid="panelLabel" />
                    <Description resid="panelTip" />
                  </Supertip>
                  <Icon>
                    <bt:Image size="16" resid="icon16" />
                    <bt:Image size="32" resid="icon32" />
                    <bt:Image size="80" resid="icon80" />
                  </Icon>
                  <Action xsi:type="ShowTaskpane">
                    <SourceLocation resid="draftUrl" />
                    <SupportsPinning>true</SupportsPinning>
                  </Action>
                </Control>
                <Control xsi:type="Button" id="amarnaiCommentsButton">
                  <Label resid="commentsLabel" />
                  <Supertip>
                    <Title resid="commentsLabel" />
                    <Description resid="commentsTip" />
                  </Supertip>
                  <Icon>
                    <bt:Image size="16" resid="icon16" />
                    <bt:Image size="32" resid="icon32" />
                    <bt:Image size="80" resid="icon80" />
                  </Icon>
                  <Action xsi:type="ShowTaskpane">
                    <SourceLocation resid="commentsUrl" />
                    <SupportsPinning>true</SupportsPinning>
                  </Action>
                </Control>
              </Group>
            </OfficeTab>
          </ExtensionPoint>
        </DesktopFormFactor>
      </Host>
    </Hosts>
    <Resources>
      <bt:Images>
        <bt:Image id="icon16" DefaultValue="${b}/outlook/icon-16.png" />
        <bt:Image id="icon32" DefaultValue="${b}/outlook/icon-32.png" />
        <bt:Image id="icon80" DefaultValue="${b}/outlook/icon-80.png" />
      </bt:Images>
      <bt:Urls>
        <bt:Url id="paneUrl" DefaultValue="${paneUrl}" />
        <bt:Url id="draftUrl" DefaultValue="${draftUrl}" />
        <bt:Url id="commentsUrl" DefaultValue="${commentsUrl}" />
      </bt:Urls>
      <bt:ShortStrings>
        <bt:String id="groupLabel" DefaultValue="Aziru" />
        <bt:String id="panelLabel" DefaultValue="Aziru" />
        <bt:String id="commentsLabel" DefaultValue="Comments" />
      </bt:ShortStrings>
      <bt:LongStrings>
        <bt:String id="panelTip" DefaultValue="Open the Aziru panel for this conversation: where it was filed, what it says, and a draft reply you review and send yourself." />
        <bt:String id="commentsTip" DefaultValue="Discuss this conversation with your team in Aziru. Comments stay in Aziru and are never sent by email." />
      </bt:LongStrings>
    </Resources>
  </VersionOverrides>
</OfficeApp>
`;
}

export async function GET(): Promise<NextResponse> {
  if (!isOutlookAddinEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  let addinId: string;
  try {
    addinId = outlookAddinId();
  } catch (e) {
    // A misconfigured Id must not ship a manifest Outlook will reject with no
    // explanation. 500 with the reason in the log is the honest answer.
    console.error("[outlook-manifest]", e);
    return new NextResponse("Add-in is misconfigured", { status: 500 });
  }

  return new NextResponse(buildManifest(appBaseUrl(), addinId), {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      // Outlook and AppSource re-fetch this; a stale copy pins users to an old
      // pane URL, and the body is cheap to regenerate.
      "cache-control": "no-store",
    },
  });
}
