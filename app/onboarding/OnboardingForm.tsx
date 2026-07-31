import Button from "@/app/components/ui/Button";
import Input from "@/app/components/ui/Input";
import Logo from "@/app/components/ui/Logo";
import Select from "@/app/components/ui/Select";
import styles from "./onboarding.module.css";

export default function OnboardingForm() {
  return (
    <section className={styles.screen}>
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.logoLink}>
            <Logo className={styles.logo} />
          </div>
        </header>

        <main className={styles.main}>
          <div className={styles.content}>
            <h1 className={styles.title}>Create your page.</h1>

            <p className={styles.intro}>In only 9 seconds.</p>

            <form className={styles.formCard}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="profession">
                  Profession
                </label>
                <Input
                  id="profession"
                  name="profession"
                  placeholder="Coach, therapist, consultant…"
                  className={styles.control}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="displayName">
                  Display name
                </label>
                <Input
                  id="displayName"
                  name="displayName"
                  placeholder="John Doe"
                  className={styles.control}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="service">
                  First service
                </label>
                <Input
                  id="service"
                  name="service"
                  placeholder="Consultation"
                  className={styles.control}
                />
              </div>

              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="duration">
                    Duration
                  </label>

                  <Select
                    id="duration"
                    name="duration"
                    defaultValue="60"
                    className={`${styles.control} ${styles.select}`}
                  >
                    <option value="30">30 min</option>
                    <option value="45">45 min</option>
                    <option value="60">60 min</option>
                    <option value="90">90 min</option>
                  </Select>
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="price">
                    Price
                  </label>

                  <div className={styles.priceWrap}>
                    <Input
                      id="price"
                      name="price"
                      type="number"
                      defaultValue="80"
                      className={`${styles.control} ${styles.priceInput}`}
                    />

                    <Select
                      id="currency"
                      name="currency"
                      defaultValue="EUR"
                      className={`${styles.control} ${styles.select} ${styles.currencySelect}`}
                    >
                      <option value="EUR">€ EUR</option>
                      <option value="USD">$ USD</option>
                      <option value="GBP">£ GBP</option>
                      <option value="CHF">CHF</option>
                    </Select>
                  </div>
                </div>
              </div>

              <Button type="submit" className={styles.submitButton}>
                Create my page
              </Button>
            </form>

            <p className={styles.note}>
              You can change everything later.
            </p>
          </div>
        </main>
      </div>
    </section>
  );
}
