import {
  ScrollText, UserCheck, Building2, Sparkles, ShieldAlert, Award, UserX, RefreshCw, Mail,
} from 'lucide-react';
import LegalLayout, { LegalSection } from '../components/LegalLayout';
import { useDocumentMeta } from '../hooks/useDocumentMeta';

const TOC = [
  { id: 'agreement', label: 'Agreement to these terms' },
  { id: 'accounts', label: 'Accounts and eligibility' },
  { id: 'school-scoped', label: 'School-scoped access' },
  { id: 'ai-content', label: 'AI-generated content' },
  { id: 'acceptable-use', label: 'Acceptable use' },
  { id: 'ownership', label: 'Content ownership' },
  { id: 'termination', label: 'Suspension and termination' },
  { id: 'changes', label: 'Changes to these Terms' },
  { id: 'contact', label: 'Contact' },
];

export default function TermsOfServicePage() {
  useDocumentMeta({
    title: 'Terms of Service — SarasTech Teacher Assistant',
    description:
      'The rules for using the SarasTech Teacher Assistant — accounts, school-scoped access, AI-generated content, acceptable use, and content ownership, in plain language.',
    canonical: 'https://www.sarastech.co.in/terms',
  });

  return (
    <LegalLayout
      icon={ScrollText}
      title="Terms of Service"
      intro="The rules for using the SarasTech Teacher Assistant, in plain language."
      updated="September 5, 2026"
      toc={TOC}
      otherDoc={{ to: '/privacy', label: 'Privacy Policy' }}
    >
      <LegalSection id="agreement" icon={ScrollText} title="1. Agreement to these terms">
        <p>
          These Terms of Service ("Terms") govern access to and use of the
          SarasTech Teacher Assistant application, including its web, mobile,
          and API interfaces (together, the "Service"). By creating an
          account or otherwise using the Service, you agree to be bound by
          these Terms. If you are using the Service on behalf of a school or
          district, you confirm that you are authorized to accept these
          Terms on that organization's behalf.
        </p>
      </LegalSection>

      <LegalSection id="accounts" icon={UserCheck} title="2. Accounts and eligibility">
        <p>
          The Service is intended for teachers, school administrators, and
          other education staff invited or approved by a participating
          school. Accounts are secured with a PIN and issued short-lived
          access tokens; you are responsible for keeping your login
          credentials confidential and for all activity under your account.
          Repeated failed sign-in attempts may temporarily lock an account
          to protect it from unauthorized access.
        </p>
      </LegalSection>

      <LegalSection id="school-scoped" icon={Building2} title="3. School-scoped access">
        <p>
          Your access to resources, classroom data, attendance records, and
          analytics is scoped to your own school (or, for district and
          administrator roles, the district or organization you belong to).
          We do not display or share another school's data with you, and a
          resource or record that does not exist or does not belong to you
          will appear the same way — not found — so that what other schools
          store is never revealed.
        </p>
      </LegalSection>

      <LegalSection id="ai-content" icon={Sparkles} title="4. AI-generated content">
        <p>
          The Service uses a third-party AI model to help generate teaching
          resources, lesson plans, quizzes, and similar content based on
          prompts and materials you provide. AI-generated content may
          contain errors or inaccuracies and should be reviewed by a
          qualified educator before classroom use. You remain responsible
          for how generated content is used with students.
        </p>
      </LegalSection>

      <LegalSection id="acceptable-use" icon={ShieldAlert} title="5. Acceptable use">
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service to store or generate content that is unlawful, harassing, or harmful to students or staff;</li>
          <li>Attempt to access another user's or school's account or data without authorization;</li>
          <li>Interfere with, disrupt, or attempt to circumvent security, rate limits, or access controls of the Service;</li>
          <li>Use the Service in a way that violates applicable education, privacy, or data-protection law.</li>
        </ul>
      </LegalSection>

      <LegalSection id="ownership" icon={Award} title="6. Content ownership">
        <p>
          You retain ownership of the materials you upload and the
          resources you create using the Service. You grant us a limited
          license to store and process that content solely to provide the
          Service to you and your school.
        </p>
      </LegalSection>

      <LegalSection id="termination" icon={UserX} title="7. Suspension and termination">
        <p>
          We may suspend or terminate access to the Service for accounts
          that violate these Terms, pose a security risk, or at a school
          administrator's request for accounts within that school. You may
          stop using the Service, or ask your school administrator to
          deactivate your account, at any time.
        </p>
      </LegalSection>

      <LegalSection id="changes" icon={RefreshCw} title="8. Changes to these Terms">
        <p>
          We may update these Terms from time to time. Material changes will
          be reflected by updating the "Last updated" date above. Continued
          use of the Service after changes take effect constitutes
          acceptance of the revised Terms.
        </p>
      </LegalSection>

      <LegalSection id="contact" icon={Mail} title="9. Contact">
        <p>
          Questions about these Terms can be sent through the "Need Help?"
          option in the app, or to your school administrator.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
