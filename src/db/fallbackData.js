const data = {
  brand: {
    name: "Muscle and Fitness Center",
    legalName: "Muscle and Fitness Center",
    localeName: {
      en: "Muscle and Fitness Center",
      ar: "مركز بناء ولياقة الرياضي"
    }
  },
  siteImages: {
    logo: { imageUrl: "/assets/logo.png" },
    homeHero: {
      imageUrl: "/assets/images/hero-gym.webp",
      fallbackImageUrl: "/assets/images/hero-gym.png"
    },
    authHero: {
      imageUrl: "/assets/images/hero-gym.webp",
      fallbackImageUrl: "/assets/images/hero-gym.png"
    },
    socialShare: { imageUrl: "/assets/images/hero-gym.png" }
  },
  homepage: {
    hero: {
      headline: {
        en: "What Your Mind Believes, Your Body Achieves.",
        ar: "ما يؤمن به عقلك... يحققه جسدك."
      },
      body: {
        en: "Designed to Help You Become Your Best Self.",
        ar: "صُممت لتساعدك على أن تصبح أفضل نسخة من نفسك."
      }
    },
    about: {
      title: {
        en: "Designed to Elevate Your Performance.",
        ar: "صُمم ليرتقي بأدائك."
      },
      body: {
        en: "From the facilities to the finest details, everything is designed to deliver a complete training experience worthy of your ambition.",
        ar: "من المرافق إلى أدق التفاصيل، صُمم كل شيء ليمنحك تجربة تدريب متكاملة تليق بطموحك."
      }
    },
    coaching: {
      title: {
        en: "Managed by certified coaches.",
        ar: "بإدارة افضل المدربين."
      },
      body: {
        en: "Every training program is carefully designed and professionally supervised to ensure consistent progress and an exceptional training experience.",
        ar: "كل برنامج تدريبي يُبنى بعناية، ويُتابع بإشراف احترافي يضمن تقدمًا ثابتًا وتجربة تدريب عالية الجودة."
      }
    }
  },
  plans: [
    {
      id: 1,
      name: { en: "1 Month + 7 Days Extra", ar: "شهر واحد" },
      description: { en: "Access for consistent independent training.", ar: "دخول مناسب للتدريب المنتظم باستقلالية." },
      price: 349,
      priceOriginal: 550,
      priceDiscounted: 349,
      currency: "SAR",
      billingPeriod: { en: "month", ar: "شهرياً" },
      highlighted: false,
      features: {
        en: ["Gym floor access", "Locker room access", "Member app profile"],
        ar: ["دخول صالة التدريب", "استخدام غرف تبديل الملابس", "ملف عضو رقمي"]
      }
    },
    {
      id: 2,
      name: { en: "3 Months", ar: "3 اشهر" },
      description: { en: "Coaching-led membership for measurable progress.", ar: "عضوية بإشراف تدريبي لتحقيق تقدم واضح." },
      price: 849,
      priceOriginal: 1656,
      priceDiscounted: 849,
      currency: "SAR",
      billingPeriod: { en: "month", ar: "شهرياً" },
      highlighted: true,
      features: {
        en: ["Everything in Essential", "Monthly coach review", "Body composition check", "Priority class booking"],
        ar: ["كل مزايا أساسي", "مراجعة شهرية مع المدرب", "قياس تركيب الجسم", "أولوية حجز الحصص"]
      }
    },
    {
      id: 3,
      name: { en: "6 Months", ar: "6 اشهر" },
      description: { en: "High-touch coaching and private training support.", ar: "إشراف شخصي وخدمة تدريب خاصة." },
      price: 1399,
      priceOriginal: 2651,
      priceDiscounted: 1399,
      currency: "SAR",
      billingPeriod: { en: "month", ar: "شهرياً" },
      highlighted: false,
      features: {
        en: ["Private coaching sessions", "Program design", "Recovery guidance", "Concierge scheduling"],
        ar: ["جلسات تدريب خاصة", "تصميم برنامج تدريبي", "إرشاد للتعافي", "تنسيق مواعيد خاص"]
      }
    },
    {
      id: 4,
      name: { en: "12 Months", ar: "12 اشهر" },
      description: { en: "High-touch coaching and private training support.", ar: "إشراف شخصي وخدمة تدريب خاصة." },
      price: 1849,
      priceOriginal: 5037,
      priceDiscounted: 1849,
      currency: "SAR",
      billingPeriod: { en: "month", ar: "شهرياً" },
      highlighted: false,
      features: {
        en: ["Private coaching sessions", "Program design", "Recovery guidance", "Concierge scheduling"],
        ar: ["جلسات تدريب خاصة", "تصميم برنامج تدريبي", "إرشاد للتعافي", "تنسيق مواعيد خاص"]
      }
    }
  ],
  offers: [
    {
      id: 1,
      title: { en: "Founding member rate", ar: "سعر الأعضاء المؤسسين" },
      body: {
        en: "A limited membership allocation with preferred monthly pricing.",
        ar: "عدد محدود من العضويات بسعر شهري مميز."
      },
      badge: { en: "Limited", ar: "محدود" },
      validUntil: "2026-09-30"
    },
    {
      id: 2,
      title: { en: "Assessment week", ar: "أسبوع التقييم" },
      body: {
        en: "Complimentary movement and composition assessment for new members.",
        ar: "تقييم حركة وتركيب جسم مجاني للأعضاء الجدد."
      },
      badge: { en: "New", ar: "جديد" },
      validUntil: "2026-08-15"
    }
  ],
  slides: [
    {
      id: 1,
      imageUrl: "/assets/images/offer-seasonal.webp",
      fallbackImageUrl: "/assets/images/offer-seasonal.png",
      title: { en: "Seasonal membership window", ar: "نافذة عضوية موسمية" },
      body: {
        en: "Preferred rates for members who join before the new training cycle begins.",
        ar: "أسعار مفضلة للأعضاء المنضمين قبل بداية دورة التدريب الجديدة."
      }
    },
    {
      id: 2,
      imageUrl: "/assets/images/offer-coaching.webp",
      fallbackImageUrl: "/assets/images/offer-coaching.png",
      title: { en: "Coach-led assessments", ar: "تقييمات بإشراف المدربين" },
      body: {
        en: "Start with a measured baseline and a plan built for your schedule.",
        ar: "ابدأ من نقطة قياس واضحة وخطة تناسب جدولك."
      }
    },
    {
      id: 3,
      imageUrl: "/assets/images/offer-recovery.webp",
      fallbackImageUrl: "/assets/images/offer-recovery.png",
      title: { en: "Recovery built into training", ar: "تعافٍ مدمج مع التدريب" },
      body: {
        en: "Mobility, readiness, and recovery guidance are part of the member experience.",
        ar: "المرونة، والاستعداد، وإرشادات التعافي جزء من تجربة العضوية."
      }
    }
  ],
  faqs: [
    {
      question: { en: "What are the club's operating hours?", ar: "ما هي أوقات عمل النادي؟" },
      answer: {
        en: `
        Saturday–Thursday: 6:00 AM – 2:00 PM<br>
        Friday: 3:00 PM – 11:00 PM
        `,
        ar: `من السبت إلى الخميس: 6:00 صباحًا – 2:00 مساءً<br>
        الجمعة: 3:00 عصرًا – 11:00 مساءً` }
    },
    {
      question: { en: "Are memberships contract-based?", ar: "ما هي مواعيد حصص اللياقة البدنية؟" },
      answer: {
        en: "Plans are monthly by default, with longer terms available for members who prefer them.",
        ar: `السبت إلى الخميس:

4:30 مساءً
8:30 مساءً
11:00 مساءً

الجمعة:

5:30 مساءً
`
      }
    },
    {
      question: { en: "Do you offer personal training?", ar: "هل توفرون تدريباً شخصياً؟" },
      answer: {
        en: "Yes. Private coaching is available through the Private plan and selected add-ons.",
        ar: "نعم. التدريب الخاص متاح ضمن باقة خاص وبعض الإضافات المختارة."
      }
    },
    {
      question: { en: "Is the Arabic experience fully supported?", ar: "هل التجربة العربية مدعومة بالكامل؟" },
      answer: {
        en: "Yes. The site, account area, and operational content are prepared for Arabic and English.",
        ar: "نعم. الموقع، ومنطقة الحساب، والمحتوى التشغيلي مجهزة للعربية والإنجليزية."
      }
    }
  ],
  contact: {
    phone: "+966569919944",
    whatsapp: "966569919944",
    email: "membership@muscle-fitness.local",
    address: {
      en: "Hyper Panda Roundabout, Jizan, Saudi Arabia",
      ar: "طريق الملك فهد، الرياض، المملكة العربية السعودية"
    },
    mapEmbedUrl:
      "https://maps.google.com/?q=Hyper+Panda+Roundabout+Jizan+Saudi+Arabia"
  },
  workingHours: [
    { day: { en: "Sunday - Thursday", ar: "الأحد - الخميس" }, hours: { en: "6:00 AM - 12:00 AM", ar: "6:00 صباحاً - 12:00 منتصف الليل" } },
    { day: { en: "Friday", ar: "الجمعة" }, hours: { en: "2:00 PM - 10:00 PM", ar: "2:00 مساءً - 10:00 مساءً" } },
    { day: { en: "Saturday", ar: "السبت" }, hours: { en: "8:00 AM - 11:00 PM", ar: "8:00 صباحاً - 11:00 مساءً" } }
  ],
  metrics: [
    { value: "", label: { en: "Calisthenics", ar: "حصص سويدي" } },
    { value: "3", label: { en: "Swimming", ar: "منطقة سباحه" } },
    { value: "1:1", label: { en: "Pro Equipment", ar: "اجهزه احترافية" } }
  ],
  admin: {
    stats: [
      { label: { en: "Active members", ar: "الأعضاء النشطون" }, value: "842", delta: "+8.4%" },
      { label: { en: "Monthly revenue", ar: "الإيراد الشهري" }, value: "SAR 418k", delta: "+12.1%" },
      { label: { en: "Renewals due", ar: "تجديدات مستحقة" }, value: "74", delta: "-3.2%" },
      { label: { en: "Open tasks", ar: "مهام مفتوحة" }, value: "16", delta: "+2" }
    ],
    users: [
      { id: 1, fullName: "Sara Al-Harbi", email: "sara@example.com", phone: "+966500000001", status: "active", plan: "Performance" },
      { id: 2, fullName: "Omar Nasser", email: "omar@example.com", phone: "+966500000002", status: "past_due", plan: "Essential" },
      { id: 3, fullName: "Noura Saleh", email: "noura@example.com", phone: "+966500000003", status: "active", plan: "Private" }
    ],
    payments: [
      { id: "PAY-2041", member: "Sara Al-Harbi", amount: "SAR 690", status: "paid", date: "2026-06-19" },
      { id: "PAY-2040", member: "Noura Saleh", amount: "SAR 1490", status: "paid", date: "2026-06-18" },
      { id: "PAY-2039", member: "Omar Nasser", amount: "SAR 390", status: "pending", date: "2026-06-17" }
    ],
    logs: [
      { id: 1, level: "info", message: "Plan Performance updated", createdAt: "2026-06-22 13:42" },
      { id: 2, level: "warning", message: "Stripe key not configured", createdAt: "2026-06-22 10:15" },
      { id: 3, level: "info", message: "Homepage offer published", createdAt: "2026-06-21 18:04" }
    ]
  }
};

module.exports = data;
