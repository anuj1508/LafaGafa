<script setup lang="ts">
import { ref } from "vue";
import ChatWidget from "./ChatWidget.vue";

/**
 * A mock practice website, so the chat widget is exercised where it will actually live.
 *
 * Every figure, hour and policy here is copied from `kb/`, which is the same corpus the agent
 * retrieves from. That is the point of the page rather than an incidental tidiness: a visitor who
 * reads £75 on the site and hears £80 from the widget has found a bug, and this is the surface
 * that makes such a bug visible.
 */

const TREATMENTS = [
  {
    name: "Check-ups and hygiene",
    detail:
      "Routine examinations and hygienist appointments, 30 or 45 minutes depending on what is needed.",
    from: "£55",
  },
  {
    name: "Fillings and crowns",
    detail: "White fillings, crowns and bridges, quoted in writing after an examination.",
    from: "£145",
  },
  {
    name: "Root canal treatment",
    detail: "Front teeth and molars, carried out over one or two appointments.",
    from: "£450",
  },
  {
    name: "Teeth whitening",
    detail: "Take-home kit with custom trays, gel and a review appointment included.",
    from: "£320",
  },
];

const FEES = [
  ["New patient examination", "£75"],
  ["Routine check-up", "£55"],
  ["Hygienist, 30 minutes", "£68"],
  ["Hygienist, 45 minutes", "£95"],
  ["White filling", "£145 to £260"],
  ["Crown", "£695"],
  ["Root canal, front tooth", "£450"],
  ["Root canal, molar", "£750"],
  ["Teeth whitening, take-home kit", "£320"],
];

const HOURS = [
  ["Monday to Thursday", "8:00am - 6:00pm"],
  ["Friday", "8:00am - 4:00pm"],
  ["Saturday", "9:00am - 1:00pm"],
  ["Sunday", "Closed"],
];

const FAQS = [
  {
    q: "Are you taking new patients?",
    a: "Yes, we are taking new private patients. Registration happens at your first appointment — there is no separate registration fee and no waiting list.",
  },
  {
    q: "What happens at a first visit?",
    a: "A new patient examination lasting 40 minutes. It covers a full check of teeth, gums and soft tissues, X-rays if they are needed, and a written treatment plan with costs if anything needs doing. Bring a list of any medication you take.",
  },
  {
    q: "Do you take NHS patients?",
    a: "No, this practice is private only. We are happy to point you towards NHS practices taking new registrations, though availability changes constantly and we cannot hold a list.",
  },
  {
    q: "I am nervous about the dentist. Can you help?",
    a: "Tell us when you book. We book longer appointments for anxious patients at no extra cost, and several of our dentists have particular experience with dental phobia. Some treatments can be done under sedation, assessed case by case at an appointment.",
  },
  {
    q: "How do I pay?",
    a: "Card or bank transfer at the appointment. Treatment over £500 can be split into three monthly payments with no interest, arranged at reception before treatment begins.",
  },
  {
    q: "What if I need to cancel?",
    a: "We ask for 24 hours' notice. Late cancellations and missed appointments are charged at £35 for a check-up and £45 for a longer appointment.",
  },
  {
    q: "Where can I park?",
    a: "There are four spaces behind the building, reached from Carter Lane rather than Fairfax Road. They are often full mid-morning. There is metered street parking on Fairfax Road, free after 6pm.",
  },
  {
    q: "What about an emergency out of hours?",
    a: "Registered patients can call the practice number and follow the emergency prompt. This reaches an on-call dentist rather than the practice, and there is a call-out fee which they confirm before attending.",
  },
];

const openFaq = ref<number | null>(0);
</script>

<template>
  <div class="site">
    <header class="nav">
      <a class="logo" href="#top">
        <span class="mark" aria-hidden="true">N</span>
        <span>Northwind Dental</span>
      </a>
      <nav>
        <a href="#treatments">Treatments</a>
        <a href="#fees">Fees</a>
        <a href="#visiting">Visiting</a>
        <a href="#faqs">FAQs</a>
      </nav>
      <a class="cta" href="#top">Book an appointment</a>
    </header>

    <main>
      <section id="top" class="hero">
        <div class="hero-copy">
          <p class="eyebrow">On Fairfax Road since 2004</p>
          <h1>Dentistry without the wait, or the lecture.</h1>
          <p class="lede">
            Four surgeries, six dentists and three hygienists, two minutes from Northwind station.
            We are taking new private patients, and you can register at your first appointment.
          </p>
          <div class="hero-actions">
            <a class="primary" href="#faqs">See what a first visit involves</a>
            <span class="hint">
              Or use the button in the corner to talk to Clare, our front desk assistant, about a
              time that suits you.
            </span>
          </div>
          <dl class="proof">
            <div>
              <dt>New patient exam</dt>
              <dd>£75</dd>
            </div>
            <div>
              <dt>First visit</dt>
              <dd>40 minutes</dd>
            </div>
            <div>
              <dt>Waiting list</dt>
              <dd>None</dd>
            </div>
          </dl>
        </div>
        <aside class="hero-card">
          <h2>Opening hours</h2>
          <ul class="hours">
            <li v-for="[day, time] in HOURS" :key="day">
              <span>{{ day }}</span
              ><span>{{ time }}</span>
            </li>
          </ul>
          <p class="note">
            Saturdays are for check-ups and hygienist appointments only. The last appointment of the
            day starts 30 minutes before closing. Closed on public holidays.
          </p>
        </aside>
      </section>

      <section id="treatments" class="band">
        <h2>What we do</h2>
        <p class="section-lede">
          Fees for anything not listed are given after an examination, in writing, before treatment
          starts. We do not quote for treatment we have not assessed.
        </p>
        <div class="cards">
          <article v-for="treatment in TREATMENTS" :key="treatment.name">
            <h3>{{ treatment.name }}</h3>
            <p>{{ treatment.detail }}</p>
            <p class="from">
              from <strong>{{ treatment.from }}</strong>
            </p>
          </article>
        </div>
      </section>

      <section id="fees" class="band alt">
        <div class="split">
          <div>
            <h2>Fees</h2>
            <p class="section-lede">
              Private fees, current from January 2026, including VAT where it applies.
            </p>
            <table class="fees">
              <tbody>
                <tr v-for="[treatment, fee] in FEES" :key="treatment">
                  <th scope="row">{{ treatment }}</th>
                  <td>{{ fee }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <aside class="panel-card">
            <h3>Paying</h3>
            <p>
              Card or bank transfer at the appointment. Treatment over £500 can be split into three
              monthly payments with no interest, arranged at reception before treatment begins.
            </p>
            <h3>Nervous patients</h3>
            <p>
              We book longer appointments for anxious patients at no extra cost. Several of our
              dentists have particular experience with dental phobia — mention it when you book.
            </p>
          </aside>
        </div>
      </section>

      <section id="visiting" class="band">
        <h2>Visiting us</h2>
        <div class="cards three">
          <article>
            <h3>Getting here</h3>
            <p>
              Fairfax Road, two minutes from Northwind station. The 14 and 41 buses stop outside.
            </p>
          </article>
          <article>
            <h3>Parking</h3>
            <p>
              Four spaces behind the building, reached from Carter Lane rather than Fairfax Road.
              Often full mid-morning. Metered parking on Fairfax Road is free after 6pm.
            </p>
          </article>
          <article>
            <h3>Access</h3>
            <p>
              Step-free from the street, and a hearing loop at reception. A ground floor surgery can
              be arranged on request when booking — worth mentioning at the time, as it cannot
              always be arranged on the day.
            </p>
          </article>
        </div>
      </section>

      <section id="faqs" class="band alt">
        <h2>Questions we get asked</h2>
        <div class="faqs">
          <article v-for="(faq, index) in FAQS" :key="faq.q" :class="{ open: openFaq === index }">
            <button
              :aria-expanded="openFaq === index"
              @click="openFaq = openFaq === index ? null : index"
            >
              <span>{{ faq.q }}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <p v-show="openFaq === index">{{ faq.a }}</p>
          </article>
        </div>
        <p class="section-lede centred">
          Not covered here? Clare can answer most things, and will put you through to a person for
          anything clinical.
        </p>
      </section>
    </main>

    <footer>
      <div>
        <strong>Northwind Dental</strong>
        <p>Fairfax Road. Reception is open during practice hours.</p>
        <p>
          Email is answered within one working day. It is not monitored out of hours — for anything
          urgent, please call.
        </p>
      </div>
      <p class="fine">
        A demonstration site for a conversation AI harness. Not a real practice, and no appointment
        made here is real.
      </p>
    </footer>

    <ChatWidget />
  </div>
</template>
