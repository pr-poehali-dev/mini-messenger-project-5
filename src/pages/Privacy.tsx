export default function Privacy() {
  return (
    <div className="min-h-screen" style={{ background: '#f0f4fa' }}>
      <header className="bg-blue-600 px-6 py-4">
        <a href="/" className="text-white font-bold text-lg">← Вай Мессенджер</a>
      </header>
      <div className="max-w-2xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Политика конфиденциальности</h1>
        <p className="text-slate-400 text-sm mb-8">Последнее обновление: 26 июня 2026 г.</p>

        <div className="bg-white rounded-2xl p-6 space-y-6 text-sm text-slate-700 leading-relaxed border border-slate-100">

          <section>
            <h2 className="font-bold text-base text-slate-800 mb-2">1. Общие положения</h2>
            <p>Настоящая Политика конфиденциальности регулирует порядок обработки и использования персональных данных пользователей мессенджера «Вай Мессенджер» (далее — Приложение). Используя Приложение, вы соглашаетесь с условиями данной Политики.</p>
          </section>

          <section>
            <h2 className="font-bold text-base text-slate-800 mb-2">2. Какие данные мы собираем</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Имя пользователя (никнейм) — придумывается вами при регистрации</li>
              <li>Пароль — хранится в зашифрованном виде (SHA-256)</li>
              <li>Город и дата рождения — указываются добровольно при заполнении профиля</li>
              <li>Фотография профиля — загружается добровольно</li>
              <li>Сообщения в чатах — хранятся для обеспечения работы мессенджера</li>
              <li>Уникальный идентификатор устройства — для автоматического входа</li>
              <li>Статус онлайн и время последнего посещения</li>
            </ul>
          </section>

          <section>
            <h2 className="font-bold text-base text-slate-800 mb-2">3. Как мы используем данные</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Для обеспечения работы функций мессенджера (чаты, звонки, уведомления)</li>
              <li>Для идентификации пользователя при входе в систему</li>
              <li>Для отображения профиля другим пользователям</li>
              <li>Для рассылки системных уведомлений от имени Вай Мессенджер</li>
            </ul>
          </section>

          <section>
            <h2 className="font-bold text-base text-slate-800 mb-2">4. Передача данных третьим лицам</h2>
            <p>Мы не продаём и не передаём ваши персональные данные третьим лицам. Данные могут быть раскрыты только по требованию уполномоченных государственных органов в соответствии с законодательством Российской Федерации.</p>
          </section>

          <section>
            <h2 className="font-bold text-base text-slate-800 mb-2">5. Хранение данных</h2>
            <p>Данные хранятся на защищённых серверах. Переписка и файлы хранятся до момента удаления аккаунта пользователем. При удалении аккаунта все данные удаляются безвозвратно.</p>
          </section>

          <section>
            <h2 className="font-bold text-base text-slate-800 mb-2">6. Права пользователей</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Вы можете в любой момент изменить данные профиля</li>
              <li>Вы можете удалить аккаунт и все связанные данные через настройки приложения</li>
              <li>Вы можете запросить информацию о хранимых данных, написав нам</li>
            </ul>
          </section>

          <section>
            <h2 className="font-bold text-base text-slate-800 mb-2">7. Безопасность</h2>
            <p>Мы применяем технические меры защиты данных: шифрование паролей, защищённое HTTPS-соединение, разграничение доступа. Тем не менее, полная безопасность передачи данных через интернет не может быть гарантирована.</p>
          </section>

          <section>
            <h2 className="font-bold text-base text-slate-800 mb-2">8. Контакты</h2>
            <p>По вопросам обработки персональных данных обращайтесь: <a href="mailto:muratdzaurov@mail.ru" className="text-blue-600 underline">muratdzaurov@mail.ru</a></p>
          </section>

          <section>
            <h2 className="font-bold text-base text-slate-800 mb-2">9. Изменения политики</h2>
            <p>Мы оставляем за собой право вносить изменения в настоящую Политику. Актуальная версия всегда доступна по адресу: <span className="text-blue-600">/privacy</span></p>
          </section>
        </div>
      </div>
    </div>
  );
}
