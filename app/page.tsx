import Header from "@/components/Header";
import Hero from "@/components/Hero";
import About from "@/components/About";
import Portfolio from "@/components/Portfolio";
import Strategy from "@/components/Strategy";
import CapitalRaising from "@/components/CapitalRaising";
import AmazonConsulting from "@/components/AmazonConsulting";
import Contact from "@/components/Contact";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <main>
      <Header />
      <Hero />
      <About />
      <Portfolio />
      <Strategy />
      <CapitalRaising />
      <AmazonConsulting />
      <Contact />
      <Footer />
    </main>
  );
}
