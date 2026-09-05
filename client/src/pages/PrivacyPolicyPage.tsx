import {
  Lock, Database, Settings2, Sparkles, ShieldCheck, Clock, GraduationCap, UserCheck, RefreshCw, Mail,
} from 'lucide-react';
import LegalLayout, { LegalSection } from '../components/LegalLayout';

const TOC = [
  { id: 'collect', label: 'Information we collect' },
  { id: 'use', label: 'How we use your information' },
  { id: 'ai-processing', label: 'AI processing' },
  { id: 'storage', label: 'Data storage and security' },
  { id: 'retention', label: 'Data retention' },
  { id: 'children', label: "Children's information" },
  { id: 'rights', label: 'Your choices and rights' },
  { id: 'changes', label: 'Changes to this policy' },
  { id: 'contact', label: 'Contact' },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalLayout
      icon={Lock}
      title="Privacy Policy"
      intro="What the SarasTech Teacher Assistant collects, why, and how it's protected."
      updated="September 5, 2026"
      toc={TOC}
      otherDoc={{ to: '/terms', label: 'Terms of Service' }}
    >
      <LegalSection id="collect" icon={Database} title="1. Information we collect">
        <p>
          When you use the SarasTech Teacher Assistant, we collect account
          information (name, email, school, role), authentication data
          (a securely hashed PIN — never your PIN in plain text), and the
          content you create or upload through the Service, such as
          teaching resources, classroom rosters, and attendance records.
        </p>
      </LegalSection>

      <LegalSection id="use" icon={Settings2} title="2. How we use your information">
        <p>We use the information we collect to:</p>
        <ul>
          <li>Provide, maintain, and secure your account and the Service;</li>
          <li>Generate teaching resources and other AI-assisted content you request;</li>
          <li>Scope your access to your own school or district's data;</li>
          <li>Show school and district administrators analytics about their own organization only;</li>
          <li>Communicate with you about your account, such as sign-in activity or password resets.</li>
        </ul>
      </LegalSection>

      <LegalSection id="ai-processing" icon={Sparkles} title="3. AI processing">
        <p>
          To generate resources, the content you submit (your prompts and
          any materials you attach) is sent to a third-party AI model
          provider for processing. Your prompts and content are transmitted
          as data to be processed, not as instructions the AI model is
          configured to follow on its own — the system prompt that governs
          the assistant's behavior is fixed by us, not by user or resource
          content. The AI provider processes this data to generate a
          response; it is not used to build a public-facing product on
          behalf of the provider.
        </p>
      </LegalSection>

      <LegalSection id="storage" icon={ShieldCheck} title="4. Data storage and security">
        <p>
          Account and content data is stored in our database, protected by
          authentication (PIN hashing, short-lived access tokens, and
          revocable refresh tokens) and role-based access controls.
          Resources and history you create are private to your account
          unless a school administrator role gives visibility into your
          school's own data. We do not sell your personal information.
        </p>
      </LegalSection>

      <LegalSection id="retention" icon={Clock} title="5. Data retention">
        <p>
          We retain account and content data for as long as your account is
          active. If your school administrator deactivates your account, or
          you ask us to delete your data, we will remove it within a
          reasonable period, except where retention is required for
          security, legal, or accounting purposes.
        </p>
      </LegalSection>

      <LegalSection id="children" icon={GraduationCap} title="6. Children's information">
        <p>
          The Service is designed for use by teachers and school staff, not
          directly by students. Where classroom or attendance records
          reference student names, that data is provided and controlled by
          the school, used only to power the features the school has
          enabled, and scoped to that school the same way all other school
          data is.
        </p>
      </LegalSection>

      <LegalSection id="rights" icon={UserCheck} title="7. Your choices and rights">
        <p>
          You can review and update your account details from the Settings
          page at any time. Depending on your location and your school's
          policies, you may have additional rights to access, correct, or
          request deletion of your personal information — reach out through
          the "Need Help?" option in the app or your school administrator to
          exercise these rights.
        </p>
      </LegalSection>

      <LegalSection id="changes" icon={RefreshCw} title="8. Changes to this policy">
        <p>
          We may update this Privacy Policy from time to time. Material
          changes will be reflected by updating the "Last updated" date
          above. Continued use of the Service after changes take effect
          constitutes acceptance of the revised policy.
        </p>
      </LegalSection>

      <LegalSection id="contact" icon={Mail} title="9. Contact">
        <p>
          Questions about this Privacy Policy can be sent through the "Need
          Help?" option in the app, or to your school administrator.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
