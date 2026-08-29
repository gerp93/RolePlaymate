import { ABOUT_FAQ } from '../pages/aboutFaq';
import '../pages/About.css';

export default function AboutFaq() {
  return (
    <div className="card about-faq">
      <h2 className="about-faq-title">FAQ</h2>
      <p className="about-faq-intro text-muted">Quick answers to common questions.</p>
      <div className="about-faq-list">
        {ABOUT_FAQ.map((item) => (
          <details key={item.id} className="about-faq-item">
            <summary className="about-faq-question">{item.question}</summary>
            <div className="about-faq-answer">{item.answer}</div>
          </details>
        ))}
      </div>
    </div>
  );
}
