# AlphaMail

an ai-powered weekly accountability partner that lives in your inbox. no app, no dashboard -- just email.

**[bealphamail.com](https://bealphamail.com)**

## what it is

alpha is an ai that checks in on your goals every sunday via email. you reply, tell it how things went, set a new goal, and repeat. it remembers everything and keeps you honest.

## user flows

### website signup

1. go to [bealphamail.com](https://bealphamail.com) and click "start your first goal"
2. enter your email on `/signup` -- alpha sends a confirmation link
3. click the link -- lands on `/welcome`, which triggers alpha's first email to you
4. reply to that email with your name and a goal
5. alpha chats back and forth until it has what it needs, then you're in
6. every sunday, alpha emails you to check in

### email-first signup

1. email alpha@bealphamail.com directly
2. alpha replies with an intro and a link to sign up
3. click the signup link (your email is pre-filled)
4. from here it's the same as website signup (steps 2-6 above)
5. any emails you sent before signing up get linked to your account

### weekly check-in (every sunday)

1. alpha emails you asking how your goal went
2. you reply with what happened and (optionally) your next goal
3. alpha responds with encouragement and confirms your new goal
4. repeat

### group accountability

cc alpha@bealphamail.com on an email with a friend. alpha will suggest creating a group so you can hold each other accountable on sundays.

## license

MIT
