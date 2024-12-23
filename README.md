# Real-Time Chat Website

This is a **real-time chat website** that allows users to connect with each other and chat in real-time. It is built using the **MERN stack** (MongoDB, Express.js, React.js, and Node.js) along with **Socket.io**, **Redux Toolkit**, and **Tailwind CSS**.
# LIVE = https://chatapp-frontend-f2varpu9a-yashsharma499s-projects.vercel.app/login
---

## Technologies Used
- **MERN Stack**
  - MongoDB
  - Express.js
  - React.js
  - Node.js
- **Socket.io**
- **Redux Toolkit**
- **Tailwind CSS**

---
#SCREENSHOTS
![image](https://github.com/user-attachments/assets/6078b1e9-a552-41fb-ae2d-f79bb8838354)

![image](https://github.com/user-attachments/assets/eb110b48-b21f-442b-8ed7-298e3958399c)

![image](https://github.com/user-attachments/assets/a3c89147-2a08-44a1-ac3e-a98ce0781892)

![image](https://github.com/user-attachments/assets/6929d8d7-96d5-4a57-9380-79c1e6ec75b5)

![image](https://github.com/user-attachments/assets/6e656128-3cde-4178-bfa9-4114910cf243)














## Features

### Core Features
- **Real-time Chat**: Users can send and receive messages instantly.
- **User Authentication**:
  - Sign up, log in, and log out functionality using **JWT**.
  - Option for **Google Authentication**.
- **Group Creation**: Users can create chat rooms and invite others to join.
- **Notifications**: Receive notifications for new messages.
- **Emojis**: Send and receive emojis in messages.
- **Media Sharing**: Users can send and receive photos, videos, audio files, and other file types.

### Additional Features
- **Profile Management**:
  - Update avatar and display name.
- **Search Functionality**:
  - Search for users or chat rooms.
- **Responsive Design**:
  - Optimized for various screen sizes and devices.

---

## Installation and Setup

### Prerequisites
Ensure you have the following installed on your machine:
- **Node.js** (v14 or later)
- **MongoDB** (local or cloud instance)

### Steps to Run Locally

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/your-username/real-time-chat.git
   cd real-time-chat
   ```

2. **Backend Setup**:
   - Navigate to the backend directory:
     ```bash
     cd backend
     ```
   - Install dependencies:
     ```bash
     npm install
     ```
   - Create a `.env` file and configure the following:
     ```env
     MONGO_URI=your-mongodb-connection-string
     JWT_SECRET=your-jwt-secret
     GOOGLE_CLIENT_ID=your-google-client-id
     GOOGLE_CLIENT_SECRET=your-google-client-secret
     ```
   - Start the server:
     ```bash
     npm run dev
     ```

3. **Frontend Setup**:
   - Navigate to the frontend directory:
     ```bash
     cd ../frontend
     ```
   - Install dependencies:
     ```bash
     npm install
     ```
   - Start the React development server:
     ```bash
     npm start
     ```

4. **Access the Application**:
   - Open your browser and go to `http://localhost:3000`.

---

## Project Structure

### Backend
- **`server.js`**: Entry point for the server.
- **Routes**: API endpoints for authentication, messaging, and user management.
- **Socket.io**: Manages real-time communication between clients.

### Frontend
- **React Components**: Modular UI components.
- **Redux Toolkit**: Manages application state.
- **Tailwind CSS**: Styles and responsive design.

---
