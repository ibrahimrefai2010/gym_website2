# دليل الإدارة · Admin guide

مركز بناء ولياقة الرياضي — Muscle and Fitness Center

يغطي هذا الدليل المهام اليومية في لوحة الإدارة (`/admin.html`). كل قسم بالعربية ثم بالإنجليزية.
This guide covers day-to-day tasks in the admin panel (`/admin.html`). Each section is in Arabic, then English.

---

## الفروع والتبديل الآمن بينها · Branches and switching safely

**بالعربية**
- كل موظف مرتبط بفرع واحد، ويرى بيانات فرعه فقط. لا توجد أي إعدادات يحتاج لتغييرها.
- مشرف كل الفروع (super_admin أو صلاحية `branches:manage`) يرى قائمة **«الفرع المعروض»** أعلى اللوحة، وتظهر بجانب العنوان شارة ملوّنة باسم الفرع الحالي (ذهبي للفرع الرئيسي، وردي للفرع النسائي).
- قبل أي إجراء مهم (استرداد، حذف، تغيير سعر، تجميد) تأكد من الشارة. كل نافذة تأكيد تذكر اسم الفرع.
- يبقى الاختيار محفوظًا عند التنقل بين الصفحات. يتم التحقق من الصلاحية في الخادم، فلا يمكن لموظف عادي رؤية فرع آخر حتى لو عدّل الطلب.

**In English**
- Every staff account belongs to one branch and only ever sees that branch. Nothing to configure.
- A cross-branch admin (super_admin, or the `branches:manage` permission) gets a **"Viewing branch"** selector at the top, and a coloured badge next to the title always shows the branch on screen (gold = Main, rose = Women's).
- Before anything consequential (refund, delete, price change, freeze) check the badge — every confirmation dialog also names the branch.
- The choice is remembered while you move around. It is enforced on the server: a regular staff account cannot see another branch even by editing requests.

## إضافة عضو جديد · Adding a member

**بالعربية**
1. **المستخدمون** ← استخدم البحث للتأكد أن العضو غير مسجّل (ابحث برقم العضوية أو الجوال أو البريد).
2. أنشئ العضو (أو حوّل عميلًا محتملًا من **الرسائل** ← «تحويل إلى عضو»). يُضاف العضو دائمًا إلى الفرع المعروض حاليًا، ويحصل تلقائيًا على رقم عضوية وبطاقة QR.
3. لاستلام الدفعة وتفعيل العضوية انتقل إلى **المدفوعات** ← «تسجيل دفعة في الاستقبال» (انظر القسم التالي).
- يمكن لنفس البريد أو الجوال أن يملك حسابًا منفصلًا في كل فرع.

**In English**
1. **Users** → search first (member code, phone or email) to make sure the person is not already registered.
2. Create the member (or convert a lead from **Messages** → "Convert to member"). The member is always created in the branch you are viewing and automatically gets a member code and QR card.
3. To take payment and activate the membership go to **Payments** → "Record a payment at reception" (next section).
- The same email or phone can have a separate account in each branch.

## تسجيل دفعة وإصدار فاتورة · Recording a payment and issuing an invoice

**بالعربية**
1. **المدفوعات** ← «تسجيل دفعة في الاستقبال».
2. ابحث عن العضو، اختر الباقة، واختر طريقة الدفع (نقدًا، بطاقة عبر جهاز نقاط البيع، تحويل بنكي) وأدخل رقم الإيصال إن وجد.
3. اضغط «تسجيل الدفعة وإصدار الفاتورة» وأكّد (تذكر النافذة الفرع والمبلغ).
- في عملية واحدة: تُسجَّل الدفعة، وتُفعَّل العضوية (أو تُمدَّد إن كانت نشطة)، وتصدر فاتورة ضريبية مبسطة متوافقة مع هيئة الزكاة برقم تسلسلي للفرع ورمز QR.
- الضغط مرتين لا ينشئ دفعتين.
- الأسعار شاملة ضريبة القيمة المضافة 15٪. تُعرض الضريبة في الفاتورة.
- لتحميل الفاتورة: جدول **الفواتير الضريبية** ← PDF.

**In English**
1. **Payments** → "Record a payment at reception".
2. Find the member, choose the plan and the method (cash, card on the POS terminal, bank transfer), optionally the receipt number.
3. Click "Record payment & issue invoice" and confirm (the dialog names the branch and amount).
- In one step: the payment is recorded, the membership is activated (or extended if already active), and a ZATCA simplified tax invoice is issued with the branch's sequential number and QR code.
- Double-clicking never records twice.
- Prices include 15% VAT; the invoice shows the VAT split.
- Download any invoice from **Tax invoices** → PDF.

## الدفع الإلكتروني عبر ميسر · Online payment with Moyasar

**بالعربية**
- يدفع العضو من حسابه: **عضويتي** ← اختيار الباقة ← «ادفع إلكترونيًا» (مدى، فيزا، ماستركارد، Apple Pay عبر صفحة ميسر الآمنة).
- بعد الدفع يعود العضو إلى حسابه ويرى نتيجة الدفع. تُفعَّل العضوية أو تُمدَّد، وتصدر الفاتورة تلقائيًا.
- إن فشلت العملية لا تتغير العضوية، ويصل للعضو إشعار، وتُنشأ مهمة متابعة للفرع.
- كل الحالات تظهر في **المدفوعات** (طريقة الدفع «إلكتروني (ميسر)»، مع سبب الفشل إن وجد).

**In English**
- Members pay from their account: **My Membership** → choose a plan → "Pay online" (mada, Visa, Mastercard, Apple Pay on Moyasar's secure page).
- After paying, the member returns to their account and sees the result. The membership is activated or extended and the invoice is issued automatically.
- If a payment fails, nothing changes, the member is notified, and a follow-up task is created for the branch.
- Everything appears in **Payments** (method "Online (Moyasar)", with the failure reason when there is one).

## تسجيل دخول الأعضاء في الاستقبال · Reception check-in

**بالعربية**
- **الاستقبال وتسجيل الدخول** ← امسح بطاقة QR بالماسح اليدوي أو اكتب رقم العضوية أو الجوال أو البريد.
- يظهر ترحيب أخضر عند السماح، أو شاشة حمراء بالسبب (منتهية، مجمّدة، موقوف، فرع آخر…).
- «وضع الاستقبال» يعرض المحطة بملء الشاشة. المسح مرتين خلال 5 دقائق لا يسجل زيارة ثانية.
- يعرض القسم سجل اليوم، وإجماليات اليوم والأسبوع والشهر، وخريطة أوقات الذروة، مع التصدير.

**In English**
- **Reception check-in** → scan the QR card with a handheld scanner, or type the member code, phone or email.
- Green welcome when allowed; red screen with the reason otherwise (expired, frozen, suspended, other branch…).
- "Reception mode" makes the station full-screen. A second scan within 5 minutes does not record a second visit.
- Today's log, day/week/month totals, the peak-hours grid and exports are on the same screen.

## تجميد العضوية وتمديدها · Freezing and extending a membership

**بالعربية**
- **المستخدمون** ← اضغط على العضو ← أزرار الإجراءات.
- **تجميد**: أدخل عدد الأيام والسبب. لا يستطيع العضو الدخول أثناء التجميد، وتُضاف أيام التجميد إلى تاريخ الانتهاء.
- **إلغاء التجميد**: تُعاد الأيام غير المستخدمة.
- **تمديد**: عدد الأيام وسبب إلزامي (يُحفظ كملاحظة داخلية).
- **إيقاف الحساب**، و**بطاقة QR جديدة** (تتوقف البطاقة القديمة فورًا)، و**حذف العضو** (يبقى سجله المالي).

**In English**
- **Users** → click the member → action buttons.
- **Freeze**: number of days and a reason. The member cannot check in while frozen; frozen days are added back to the end date.
- **Unfreeze**: unused days are returned.
- **Extend**: days plus a mandatory reason (saved as an internal note).
- **Suspend account**, **New QR card** (the old card stops working immediately), **Delete member** (financial history is kept).

## المهام والمتابعة · Tasks and follow-ups

**بالعربية**
- تُنشأ مهام تلقائيًا عند: قرب انتهاء عضوية (7/3/1 أيام)، عميل محتمل جديد، فشل دفعة إلكترونية، وعضو منقطع عن الحضور. يمكن إيقاف كل نوع من **الإعدادات**.
- **المهام** ← «مهامي» لعرض المهام المسندة إليك. أغلق المهمة مع ملاحظة نتيجة (مثل «جدّد»، «لم يرد»).
- يعرض الرئيسية عدد المهام المفتوحة والمتأخرة. يظهر جرس التنبيهات في الأعلى أيضًا.

**In English**
- Tasks are created automatically for: memberships about to expire (7/3/1 days), new leads, failed online payments, and members who stopped visiting. Each trigger can be switched off in **Settings**.
- **Tasks** → "My tasks" for what is assigned to you. Close a task with an outcome note ("renewed", "no answer"…).
- The dashboard shows open and overdue counts; the bell at the top shows recent events.

## المساعد الذكي · AI assistant

**بالعربية**
- اسأل بالعربية أو الإنجليزية عن بيانات فرعك: «كم عضوية تنتهي هذا الأسبوع؟»، «قارن إيراد هذا الشهر بالماضي»، «من انقطع عن الحضور؟ اكتب رسالة واتساب لاستعادتهم».
- المساعد **لا يستطيع تعديل أي شيء**: لا يرسل رسائل ولا يغيّر عضويات. أي رسالة يكتبها مسودة تنسخها وترسلها بنفسك.
- لا يُرسَل للمساعد أي رقم جوال أو بريد للأعضاء. تُسجَّل كل الأسئلة في سجل التدقيق.

**In English**
- Ask in Arabic or English about your branch: "How many memberships expire this week?", "Compare this month's revenue with last month", "Who stopped coming? Draft a WhatsApp message to win them back."
- The assistant **cannot change anything**: it never sends messages or edits memberships. Messages it writes are drafts you copy and send yourself.
- Member phone numbers and emails are never sent to it. Every question is recorded in the audit log.

## استيراد الأعضاء من Excel · Importing members from Excel

**بالعربية**
1. **المستخدمون** ← «استيراد الأعضاء» ← نزّل النموذج (عربي أو إنجليزي).
2. املأ الأعمدة: الاسم والبريد والجوال إلزامية. لإضافة عضوية سابقة اكتب اسم الباقة كما هو في هذا الفرع مع تاريخي البداية والنهاية.
3. ارفع الملف واضغط «معاينة». لا يُحفظ شيء في هذه الخطوة. تظهر نتيجة كل صف وسبب الاستبعاد إن وجد.
4. اضغط «استيراد» وأكّد. تُضاف الصفوف الصحيحة فقط إلى الفرع المعروض.
- وضع «تحديث أعضاء حاليين» يطابق برقم العضوية ويعرض القيم قبل وبعد. الوضع الافتراضي يضيف فقط ولا يعدّل أحدًا.
- يضبط الأعضاء المستوردون كلمة مرورهم عبر «نسيت كلمة المرور».

**In English**
1. **Users** → "Import members" → download the template (Arabic or English).
2. Fill it in: name, email and phone are required. To carry over an existing membership, give the exact plan name used in this branch plus start and end dates.
3. Upload and click "Preview". Nothing is saved yet; every row shows its result and any reason it was skipped.
4. Click "Import" and confirm. Only valid rows are added, to the branch you are viewing.
- "Update existing members" matches on member code and shows before/after values. The default mode only adds and never changes anyone.
- Imported members set their password with "Forgot password".

## التصدير والنسخ الاحتياطي · Exports and backups

**بالعربية**
- زر «تصدير Excel» موجود في الأعضاء والمدفوعات والفواتير والعملاء المحتملين والمهام والحضور والتقارير وسجل التدقيق. يحترم الفلاتر الحالية وفرعك.
- مشرف كل الفروع فقط: **الإعدادات** ← «نسخة احتياطية كاملة (Excel)» (كل الجداول المهمة، دون كلمات المرور أو الرموز السرية).
- النسخ الاحتياطي الكامل لقاعدة البيانات يعمل تلقائيًا كل يوم (انظر README).

**In English**
- "Export Excel" is on Members, Payments, Invoices, Leads, Tasks, Attendance, Reports and the Audit log — it respects your current filters and branch.
- Cross-branch admins only: **Settings** → "Full backup (Excel)" (all core tables, no passwords or secret tokens).
- A full database backup runs automatically every day (see README).

## حسابات الموظفين والصلاحيات · Staff accounts and roles

**بالعربية**
- **حسابات الإدارة** ← أنشئ حسابًا واختر الأدوار (استقبال، محاسب، مدرب…). تظهر كلمة مرور مؤقتة **مرة واحدة**، سلّمها للموظف بشكل خاص، ويُطلب منه تغييرها عند أول دخول.
- «إعادة تعيين كلمة المرور» تنشئ كلمة مؤقتة جديدة وتسجّل خروجه من كل الأجهزة.
- لا يمكن لغير مشرف كل الفروع منح دور super_admin أو تعديل حسابه.
- **السجلات** = سجل التدقيق: من فعل ماذا ومتى ومن أي IP، مع الفلاتر والتصدير.

**In English**
- **Admin accounts** → create an account and choose roles (reception, accountant, trainer…). A temporary password is shown **once** — give it to the person privately; they must change it at first sign-in.
- "Reset password" issues a new temporary password and signs them out everywhere.
- Only a cross-branch super admin can grant super_admin or change such an account.
- **Logs** = the audit log: who did what, when and from which IP, with filters and export.

## التقارير المالية · Finance reports

**بالعربية**
- **التقارير المالية**: ضريبة القيمة المضافة (شهري، ربعي، سنوي، حسب طريقة الدفع)، ورقة عمل الزكاة (حسب السنة الهجرية، مع مدخلات المحاسب)، الإيرادات السنوية، والتجديد والانسحاب.
- «موحّد (كل الفروع)» متاح لمشرف كل الفروع فقط. لكل فرع سجل ضريبي مستقل، والتقرير الموحد مجموعهما.
- الزكاة أداة داخلية للمحاسب ولا تظهر في فواتير العملاء أبدًا.

**In English**
- **Finance reports**: VAT (month / quarter / year, by payment method), the Zakat worksheet (by Hijri year, with the accountant's inputs), annual revenue, and renewal & churn.
- "Consolidated (all branches)" is for cross-branch admins only. Each branch is a separate VAT registration; consolidated is their sum.
- Zakat is an internal accounting tool and never appears on customer invoices.

## محتوى الموقع · Website content

**بالعربية**
- **معلومات التواصل**: الهاتف وواتساب (مع رسالة جاهزة) والعنوان وساعات العمل وروابط التواصل الاجتماعي وعنوان ووصف الصفحة لمحركات البحث، لكل فرع على حدة.
- **الأسئلة الشائعة**: لهذا الفرع، أو «مشترك بين كل الفروع» (لمشرف كل الفروع).
- **الباقات والعروض والسلايدر**: أدخل النصوص بالعربية والإنجليزية. اسحب الصفوف أو استخدم ↑ ↓ لتغيير الترتيب. للعروض والسلايدر تاريخ بداية ونهاية.
- لا يمكن حذف باقة لديها أعضاء نشطون. ألغِ تفعيلها بدلًا من ذلك.

**In English**
- **Contact info**: phone, WhatsApp (with a pre-filled message), address, hours, social links, and the search-engine title/description — per branch.
- **FAQs**: for this branch, or "Shared by every branch" (cross-branch admins).
- **Plans, offers, slider**: fill both Arabic and English. Drag rows or use ↑ ↓ to reorder. Offers and slides have start and end dates.
- A plan with active members cannot be deleted — deactivate it instead.
