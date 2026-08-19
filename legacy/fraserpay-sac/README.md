# FraserPay

![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)

FraserPay is a school payments and initiative management platform for students, booth operators, and SAC administrators. It supports account access, QR-based interactions, booth sales, transaction tracking, fund management, and dashboard views for different user roles.

## How It Works

FraserPay is a Vite + React application with route-based flows for each user type:

- Students sign in, view their dashboard, access a personal QR code, manage settings, and track recent activity.
- Booth members join or manage booths, sell products, review transactions, and update booth settings.
- SAC users use the admin dashboard to manage users, booths, funds, points, transactions, and leaderboard data.
- Shared pages like the leaderboard, booth requests, and transaction summaries tie the workflows together.
- Authentication and user state are handled through the app context layer, while transaction and booth data are managed through dedicated services and contexts.
- Firebase is used for backend services, depending on the feature area.

## Project Structure

- `src/pages/Student` - student-facing dashboard, QR code, add funds, and settings screens
- `src/pages/Booth` - booth onboarding, selling, transactions, dashboard, and settings
- `src/pages/SAC` - SAC admin dashboard and management dialogs
- `src/contexts` - auth and transaction state, operations, and hooks
- `src/components` - shared UI components
- `src/integrations` - Firebase client setup

## Getting Started

Please obtain `.env` file from the team and place it in the root directory.

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Contributors

- Yang
- Sohum
- David
- Akshat
- John Fraser SAC

## Contributing

1. Create a branch for your change.
2. Make your updates in a focused scope.
3. Run the app locally and verify the affected flows.
4. Keep the code consistent with the existing React, TypeScript, and UI patterns.
5. Open a pull request with a clear summary of what changed and why.
