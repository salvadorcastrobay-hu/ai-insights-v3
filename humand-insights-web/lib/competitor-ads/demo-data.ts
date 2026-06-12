import type { StoredAd } from "./store";
import type { AdInsight } from "./store";

// Snapshot de avisos activos de Buk (Meta Ad Library) + síntesis. Sirve como
// fallback de la página cuando la lectura de DB devuelve vacío, para que la
// vista muestre el caso real sin depender del estado de la conexión.
const PLATFORMS = ["FACEBOOK", "INSTAGRAM", "AUDIENCE_NETWORK", "MESSENGER"];

function mk(o: {
  id: string;
  collation: string;
  title: string;
  body: string;
  cta: string;
  link: string;
  img: string;
  start: string;
  format?: string;
}): StoredAd {
  return {
    source: "meta_ads",
    competitor: "Buk",
    ad_archive_id: o.id,
    collation_id: o.collation,
    page_id: "208911196408595",
    page_name: "Buk - Software de Gestión de Personas",
    is_active: true,
    ad_start_date: o.start,
    ad_end_date: null,
    publisher_platform: PLATFORMS,
    display_format: o.format ?? "DCO",
    body_text: o.body,
    title: o.title,
    cta_text: o.cta,
    cta_type: null,
    link_url: o.link,
    categories: [],
    media: { images: [o.img], videos: [] },
    country: "ALL",
    raw: null,
    first_seen_at: o.start,
    last_seen_at: o.start,
    analysis: null,
  };
}

export const DEMO_ADS: StoredAd[] = [
  mk({
    id: "862013366402843",
    collation: "818278017691292",
    title: "🎥 Agenda una cita para ver el demo gratis",
    body: "¿Sigues gestionando RRHH con procesos manuales, archivos sueltos y reprocesos interminables?\n\nCon Buk puedes centralizar toda la gestión de personas en un solo lugar 👇\n✅ Remuneraciones sin errores\n✅ Firma y control documental 100% digital\n✅ Registros DT siempre al día\n✅ Integraciones vía API con tus sistemas\nEscala tu consultora sin perder el control. 🚀",
    cta: "Learn more",
    link: "http://fb.me/",
    img: "https://scontent-bos5-1.xx.fbcdn.net/v/t39.35426-6/692509394_1500035821666598_6423398641620818496_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=104&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=pkle7MR_lsMQ7kNvwGBt-zL&_nc_oc=AdpAVNrqlbrKItVWGFwA-BrhNZtDxemSAbKL3s5bb4Q1e5LdRUzbKWltmfQ8nD9zKtQ&_nc_zt=14&_nc_ht=scontent-bos5-1.xx&_nc_gid=cjYWUMrPw2sbK5By2qzZvw&_nc_ss=7e289&oh=00_Af8fUpL0q-dfoTg6tyoVF88I_VtgoVdsVbcS4MVxNY1wFw&oe=6A2F5007",
    start: "2026-06-04T07:00:00.000Z",
  }),
  mk({
    id: "27429474973335625",
    collation: "1307173584870018",
    title: "📊 Descárgalo gratis aquí",
    body: "💡 ¿Cuánto tiempo pierde tu empresa persiguiendo boletas y corrigiendo errores? El desorden en las rendiciones tiene un costo real. En esta guía gratuita te entregamos un mapa claro: desde la normativa en Chile hasta un checklist práctico para evaluar tu gestión actual.",
    cta: "Download",
    link: "https://info.buk.cl/guia-10-senales-de-tu-proceso-de-rendiciones",
    img: "https://scontent-bos5-1.xx.fbcdn.net/v/t39.35426-6/719822262_852340554599960_5692321118199793431_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=107&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=TeqkaWpz5cwQ7kNvwGLYaE3&_nc_oc=AdpBKX_NFjeeJlyQfTb4khGxfTqi2JJWm31SR-qVW-eTyCzXSRaIEX5wzlerYlffB5o&_nc_zt=14&_nc_ht=scontent-bos5-1.xx&_nc_gid=cjYWUMrPw2sbK5By2qzZvw&_nc_ss=7e289&oh=00_Af8w0I7u-Ts0cGmuk1YZ716hH7249rdRRja5z27j-jBC3Q&oe=6A2F43D1",
    start: "2026-06-09T07:00:00.000Z",
  }),
  mk({
    id: "960685236800500",
    collation: "1264435564845979",
    title: "🌟 Más que un software",
    body: "💡 El software te atrae, pero la experiencia te hace quedarte. Descubre Buk y su servicio que marca la diferencia.",
    cta: "Learn more",
    link: "https://info.buk.cl/experiencia",
    img: "https://scontent-bos5-1.xx.fbcdn.net/v/t39.35426-6/721297305_1371498755034983_335018682337860661_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=108&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=Zh-0VnFGKPoQ7kNvwGqBWRH&_nc_oc=Adr3XGw4QGrl3HrTxwtpLmiiIvqbDfSdILZCzuk-UVwQ-uSbV--Xo4sefLwl1r1VDSE&_nc_zt=14&_nc_ht=scontent-bos5-1.xx&_nc_gid=cjYWUMrPw2sbK5By2qzZvw&_nc_ss=7e289&oh=00_Af88Yu4SnPLw7gWzInPVNR_wyxZJURWHWntn0zWzJpnarg&oe=6A2F682B",
    start: "2026-06-09T07:00:00.000Z",
  }),
  mk({
    id: "992365570161061",
    collation: "2060854298170155",
    title: "🎯 De producto a experiencia",
    body: "🌟 Un servicio que hace quedarse. Conoce cómo Buk transforma un producto en una experiencia única.",
    cta: "Learn more",
    link: "https://www.buk.cl/quienes-somos/experiencia",
    img: "https://scontent-bos5-1.xx.fbcdn.net/v/t39.35426-6/721517380_853511847828741_6424269277146784937_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=110&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=SUPctKZ4okUQ7kNvwF78nLF&_nc_oc=AdoK6eiOY-ShpbC8cb_KLj-Fykj7VoeYJhin7b_CYv12ZkeZt0Xz83691CIdZN20kfQ&_nc_zt=14&_nc_ht=scontent-bos5-1.xx&_nc_gid=cjYWUMrPw2sbK5By2qzZvw&_nc_ss=7e289&oh=00_Af-KrPjJu6QkE6jLDOXIUVl24Hzv7rd-wPL58mBBS2HdCg&oe=6A2F3E52",
    start: "2026-06-10T07:00:00.000Z",
    format: "IMAGE",
  }),
  mk({
    id: "1489396855615555",
    collation: "939915135767184",
    title: "Webinar: Reembolsos bajo la lupa SII 🔍",
    body: "Webinar Gratis 💻⭐: ¿Están los reembolsos de tu empresa realmente blindados ante una auditoría? Conoce los criterios clave del SII para respaldar gastos, asegurar el cumplimiento normativo y eliminar tareas administrativas.\n🗓️ Viernes 19 de junio · 10:00 am · Evento online",
    cta: "Sign up",
    link: "https://info.buk.cl/webinar-rendiciones-100-digitales",
    img: "https://scontent-bos5-1.xx.fbcdn.net/v/t39.35426-6/718981196_27465946616335235_8964464133582284108_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=102&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=K7DzgNzyef8Q7kNvwHnbwZG&_nc_oc=AdrN-BzVLUCKrkZrTCglbHzyRBRXDUsxFjYYNYAgaPGwV0mheLkcsE0nyaX4wGOshsc&_nc_zt=14&_nc_ht=scontent-bos5-1.xx&_nc_gid=cjYWUMrPw2sbK5By2qzZvw&_nc_ss=7e289&oh=00_Af-CKn8DMgb2iJ_KhY09OFg9igLRc4MGEIHc5gJHH41tXw&oe=6A2F74C6",
    start: "2026-06-09T07:00:00.000Z",
  }),
  mk({
    id: "960985040175445",
    collation: "2137676850422635",
    title: "Firma tus documentos en segundos",
    body: "💡 ¿Sigues gestionando personas con procesos de hace una década? El papeleo manual te quita tiempo y seguridad. Con el Módulo de Firma Digital de Buk recuperas el control: firma masiva, respaldo total de la DT y acceso desde cualquier lugar.",
    cta: "Learn more",
    link: "https://www.buk.cl/productos/administracion/gestion-documental-y-firma-digital",
    img: "https://scontent-bos5-1.xx.fbcdn.net/v/t39.35426-6/711514070_2319082948501203_2469524240920219956_n.jpg?_nc_cat=100&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=6YmOyxhKN3IQ7kNvwGCfwll&_nc_oc=AdpsSQnRkIBS6hf97tsBbaZnYXILDngCSWsrpJo4KZP1dJNbGWpup0o5O-khpb8Fs-Q&_nc_zt=14&_nc_ht=scontent-bos5-1.xx&_nc_gid=cjYWUMrPw2sbK5By2qzZvw&_nc_ss=7e289&oh=00_Af-3Eq9fq7ndY6pODCCDvlj1wBvEsoHLtsuVLhM8HJo2aQ&oe=6A2F4BDD",
    start: "2026-06-02T07:00:00.000Z",
    format: "VIDEO",
  }),
  mk({
    id: "1002071628965081",
    collation: "1707415233762591",
    title: "Simplifica tu gestión 💼",
    body: "¿Cargar contratos uno a uno? 😵 Con Buk, súbelos directo a Mi DT, sin salir de la plataforma. Ahorra tiempo de verdad ⏱️",
    cta: "Contact us",
    link: "https://info.buk.cl/control-de-asistencia",
    img: "https://scontent-bos5-1.xx.fbcdn.net/v/t39.35426-6/714722736_27373872162245811_9158089321770862361_n.jpg?_nc_cat=101&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=eMzUeMadP14Q7kNvwFAfz8F&_nc_oc=AdquQAFa92sYFTbGr3s2w7zXks1f-4ke_-wgn-_BqDkWclrHVuhC3hF_-hJwOuTDoiQ&_nc_zt=14&_nc_ht=scontent-bos5-1.xx&_nc_gid=cjYWUMrPw2sbK5By2qzZvw&_nc_ss=7e289&oh=00_Af_7tA1HeYqznXErMv3OTWs_vUspcjeNM5r9fvhwEyz9_Q&oe=6A2F62AE",
    start: "2026-06-04T07:00:00.000Z",
    format: "VIDEO",
  }),
  mk({
    id: "1014613401020540",
    collation: "26892196460397718",
    title: "🔽 Descarga guía gratuita",
    body: "📘 Guía sobre la Ley de las 40 horas. ¿Sabes cómo impactará esta nueva normativa en tu empresa? Explicación de la ley, aspectos legales clave, nuevos derechos y cómo gestionar la asistencia.",
    cta: "Download",
    link: "https://info.buk.cl/guia-ley-40-horas-algunos-aspectos-importantes",
    img: "https://scontent-bos5-1.xx.fbcdn.net/v/t39.35426-6/719483402_1948996779079475_7017280067072842911_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=110&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=nsyxU8J6PYMQ7kNvwHNEIcZ&_nc_oc=AdoK_PrS-crzUVAFdrLIgdNjSrff0-SMa-IO1TsCgtmlcOG-FIIBJ5cK5SrpyC0wH6I&_nc_zt=14&_nc_ht=scontent-bos5-1.xx&_nc_gid=cjYWUMrPw2sbK5By2qzZvw&_nc_ss=7e289&oh=00_Af8xL3bX7bUKuwWC3YQ7HedP6HJi7cgCZJ47JgyHfKhqPw&oe=6A2F4365",
    start: "2026-06-07T07:00:00.000Z",
    format: "IMAGE",
  }),
  mk({
    id: "2409234029543974",
    collation: "1942675583355134",
    title: "👉 Calcula el costo real de Buk",
    body: "¿Qué te detiene? Descubre el costo total de Buk según tus colaboradores. Control de remuneraciones, asistencia, firmas digitales, desempeño y capacitación. Ingresa tus necesidades y calcula ahora.",
    cta: "Watch more",
    link: "https://www.buk.cl/precios",
    img: "https://scontent-bos5-1.xx.fbcdn.net/v/t39.35426-6/710813087_2157973695051227_3650563996998867895_n.jpg?_nc_cat=109&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=YDElnbHmJrUQ7kNvwGLC8OR&_nc_oc=AdqrOEs9TZKJIyQ78ajDSJxdfqTSLHy-z-vIYEzOIlM_zgHbw0o3lHoKZ-0cY-jQhXc&_nc_zt=14&_nc_ht=scontent-bos5-1.xx&_nc_gid=cjYWUMrPw2sbK5By2qzZvw&_nc_ss=7e289&oh=00_Af9M24ZTQ5bC4SyaWNOETMjdzykViLoEvBuwDeDhOqHKyw&oe=6A2F4E02",
    start: "2026-06-02T07:00:00.000Z",
    format: "VIDEO",
  }),
  mk({
    id: "4036503389981753",
    collation: "995286699903819",
    title: "🚀 ¡Inscríbete ahora!",
    body: "¡Atención Chillán! Únete a nuestro Brunch Buk el 18 de junio. Aprende sobre tendencias en Gestión de Personas y haz networking. 🚀 Gran Hotel Isabel Riquelme, Chillán.",
    cta: "See details",
    link: "https://info.buk.cl/brunch-buk-en-chillan",
    img: "https://scontent-bos5-1.xx.fbcdn.net/v/t39.35426-6/713969856_1486460586294623_2391365587923543454_n.jpg?_nc_cat=106&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=_off84NpRzEQ7kNvwFyl5N-&_nc_oc=AdqqbbObtohTsDyc1WFnq6QUrL6w1FQ9ZDueNpVXijz01N7VTFObyoD6Rhr_-td9XPU&_nc_zt=14&_nc_ht=scontent-bos5-1.xx&_nc_gid=cjYWUMrPw2sbK5By2qzZvw&_nc_ss=7e289&oh=00_Af9Scr5zwRyeE0TaCzXmFyqwUdN_GUjZXCrPfMgEB5Gqeg&oe=6A2F41F6",
    start: "2026-06-05T07:00:00.000Z",
    format: "VIDEO",
  }),
  mk({
    id: "1465842055027166",
    collation: "1761228698561137",
    title: "📥 Descarga la guía gratuita",
    body: "📊 El mercado financiero se mueve más rápido que el resto del país: remuneraciones 87% superiores a la mediana, empleo +5,3% en 2026. Descubre las tendencias de la industria financiera. Descarga el informe gratuito de Buk.",
    cta: "Download",
    link: "https://info.buk.cl/variacion-remuneraciones-empleo-y-rotacion-primer-trimestre-2026",
    img: "https://scontent-bos5-1.xx.fbcdn.net/v/t39.35426-6/712208161_1011266604790546_1800926417483166105_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=103&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=SONef_a0IDcQ7kNvwEoP-xM&_nc_oc=AdqsEKcL2S3hMDICiSOvE1FPxoIMEbBOi0bpE3rnP1lG25sdKZViEzDScmwJqndBmRU&_nc_zt=14&_nc_ht=scontent-bos5-1.xx&_nc_gid=cjYWUMrPw2sbK5By2qzZvw&_nc_ss=7e289&oh=00_Af_aeSt5e0gMgMpmp7i2mZTAtImszVANC_wCb2zkRanXPg&oe=6A2F66AA",
    start: "2026-06-04T07:00:00.000Z",
  }),
  mk({
    id: "1414807963791579",
    collation: "931535253075957",
    title: "📥 Descarga la guía gratuita",
    body: "📘 ¿Sabes cuánto ganan hoy los profesionales de administración y finanzas en Chile? En nuestro ebook te lo mostramos con datos reales del mercado para definir bandas salariales con respaldo objetivo.",
    cta: "Watch more",
    link: "https://info.buk.cl/ebook-cuanto-ganan-los-profesionales-de-administracion-y-finanzas-en-chile",
    img: "https://scontent-bos5-1.xx.fbcdn.net/v/t39.35426-6/710279776_1023380633536325_2342223625232058650_n.jpg?_nc_cat=111&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=vpWoKjBBAzkQ7kNvwGk0Axv&_nc_oc=Adq-CzqNkrr8jKMQldbAOVK-PApO7jI8moOpavUHVT8fsxaFlPsB7WnbHHMyKjj9NmQ&_nc_zt=14&_nc_ht=scontent-bos5-1.xx&_nc_gid=cjYWUMrPw2sbK5By2qzZvw&_nc_ss=7e289&oh=00_Af_Iyjs4e3fnnq0MmuGKifze6nQ5ATbTPqtMW0ntsKsDIA&oe=6A2F4EC1",
    start: "2026-06-08T07:00:00.000Z",
    format: "VIDEO",
  }),
];

export const DEMO_INSIGHTS: AdInsight[] = [
  {
    competitor: "Buk",
    source: "meta_ads",
    generated_at: "2026-06-10T13:00:00.000Z",
    payload: {
      ads_analyzed: 21,
      summary:
        "Buk está martillando un mensaje central de automatización vs. procesos manuales (rendiciones, firma digital, control de asistencia) apalancado en MUCHO contenido de captación —guías, ebooks, webinars del SII y brunches presenciales— y un ángulo de diferenciación por experiencia/servicio (\"más que un software\"). Foco fuertemente Chile: SII, Dirección del Trabajo, Ley de 40 horas.",
      offer_types: [
        "Lead magnet (guías / ebooks / informes)",
        "Webinar / evento online",
        "Brunch presencial (eventos por ciudad)",
        "Demo de producto",
        "Calculadora de precios",
      ],
      angles: [
        {
          label: "Adiós a los procesos manuales",
          weight: 6,
          description:
            "Centralizar RRHH y dejar atrás planillas, papeleo y reprocesos. Su ángulo más repetido.",
          related_pains: ["Procesos manuales", "Herramientas fragmentadas"],
          example_copies: [
            "¿Sigues gestionando RRHH con procesos manuales, archivos sueltos y reprocesos interminables?",
          ],
        },
        {
          label: "Rendiciones y gastos sin dolor",
          weight: 5,
          description:
            "Módulo de Finanzas / Rendiciones, con foco en cumplimiento del SII y auditorías.",
          related_pains: ["Procesos manuales"],
          example_copies: [
            "¿Cuánto tiempo pierde tu empresa persiguiendo boletas y corrigiendo errores?",
          ],
        },
        {
          label: "Firma digital y documentos",
          weight: 3,
          description: "Firma masiva, gestión documental 100% digital y registros DT al día.",
          related_pains: ["Procesos manuales"],
          example_copies: ["Firma tus documentos en segundos. ¡Olvida el papel!"],
        },
        {
          label: "Control de asistencia / Ley 40 horas",
          weight: 3,
          description:
            "Aprovecha la coyuntura regulatoria chilena (Ley de 40 horas) como gancho de contenido.",
          related_pains: ["Procesos manuales"],
          example_copies: [
            "Guía sobre la Ley de las 40 horas: cómo impactará en tu empresa y cómo gestionar la asistencia.",
          ],
        },
        {
          label: "Más que un software: experiencia",
          weight: 4,
          description:
            "Diferenciación por servicio/atención al cliente, no por features. Ángulo de retención.",
          related_pains: [],
          example_copies: [
            "El software te atrae, pero la experiencia te hace quedarte.",
          ],
        },
        {
          label: "Transparencia de precios",
          weight: 1,
          description: "Calculadora de costos por tamaño de empresa / cotizá tus módulos.",
          related_pains: [],
          example_copies: ["Calcula el costo real de Buk según tus colaboradores."],
        },
      ],
    },
  },
];
