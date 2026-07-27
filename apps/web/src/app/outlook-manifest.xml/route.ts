import { NextResponse } from "next/server";
import { appBaseUrl, isOutlookAddinEnabled, OUTLOOK_PANEL_PATH } from "@/lib/outlook-addin";

// The Office Add-in manifest, templated from the deployment's own base URL.
//
// Classic XML with VersionOverrides rather than the newer unified JSON manifest:
// XML is what outlook.live.com (consumer accounts) and Outlook for Mac support
// today, and this add-in has to work everywhere Amarnai supports Outlook.
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
//     headless function file has no UI to say them in. A fast path can be added
//     later without changing the manifest's shape.
//   - Permissions stay at ReadItem. Amarnai reads the open conversation's id and
//     opens a reply form for the user to send themselves; it must never hold a
//     permission that would let it send or modify mail.
//
// A fixed Id is required and must never change for a published add-in: Outlook
// keys installed add-ins by it, and a new Id reads as a different add-in.
const ADDIN_ID = "6f3a5b1e-9c24-4a7d-8f16-2b8d4e0c93a1";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildManifest(base: string): string {
  const b = xmlEscape(base);
  const paneUrl = `${b}${OUTLOOK_PANEL_PATH}`;
  // The ribbon's own entry point: same pane, told to get straight to drafting.
  const draftUrl = `${paneUrl}?focus=draft`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp
  xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0"
  xmlns:mailappor="http://schemas.microsoft.com/office/mailappversionoverrides/1.0"
  xsi:type="MailApp">
  <Id>${ADDIN_ID}</Id>
  <Version>1.0.0.0</Version>
  <ProviderName>Amarnai</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="Amarnai" />
  <Description DefaultValue="Draft replies with Amarnai without leaving Outlook. Amarnai never sends email: you review and send." />
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
        <RequestedHeight>280</RequestedHeight>
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
                <Control xsi:type="Button" id="amarnaiReplyButton">
                  <Label resid="replyLabel" />
                  <Supertip>
                    <Title resid="replyLabel" />
                    <Description resid="replyTip" />
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
      </bt:Urls>
      <bt:ShortStrings>
        <bt:String id="groupLabel" DefaultValue="Amarnai" />
        <bt:String id="replyLabel" DefaultValue="Amarnai Reply" />
      </bt:ShortStrings>
      <bt:LongStrings>
        <bt:String id="replyTip" DefaultValue="Draft a reply to this conversation with Amarnai. You review and send it yourself." />
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

  return new NextResponse(buildManifest(appBaseUrl()), {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      // Outlook and AppSource re-fetch this; a stale copy pins users to an old
      // pane URL, and the body is cheap to regenerate.
      "cache-control": "no-store",
    },
  });
}
