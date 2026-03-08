Subject: Your app works on your laptop. Now what?

This is where most people get stuck. And honestly, it's where most AI-built apps go to die.

You followed a tutorial or prompted your way through building something. It runs on your computer. You can click around, it works, it's exciting. You show it to a friend by turning your laptop screen toward them.

But then someone asks "can you send me a link?" and you freeze. Because your app lives on your laptop. It's not on the internet. Nobody else can use it.

Getting from "it works on my machine" to "here's the link, try it out" is called deployment. And it's the single biggest gap I see in people building with AI.

### Why this is harder than it sounds

When your app runs on your laptop, a lot of things are happening in the background that you don't notice. Your computer knows where to find certain files. It has secret keys stored in hidden settings. The database is running locally.

When you move the app to a server on the internet, all of that has to be set up again — in a new environment that works differently than your laptop.

Three things break almost every time:

**1. Environment variables**

These are secret values your app needs — API keys, database passwords, service credentials. On your laptop, they're stored in a file that never leaves your machine. In production, you have to manually add each one to your hosting platform. Miss one and the app crashes with an error that gives you zero helpful information.

**2. Authentication config**

If your app has login/signup (and it probably does), the auth service needs to know about your production URL. Clerk, for example, needs you to add your live domain to its settings. Skip this and users can't log in, even if everything else works perfectly.

**3. Database connections**

Your local database and your production database are different. The app needs to know which one to talk to depending on where it's running. Get this wrong and your live app is either talking to an empty database or — worse — your test data.

### The good news

None of this is hard once you understand it. It's just different from building. Building is creative and fun. Deployment is logistics. It's checking boxes, copying values, and making sure everything points to the right place.

Think of it like this: building the app is designing a food truck. Deployment is getting the permits, finding a parking spot, and hooking up to electricity. Less glamorous, but nothing works without it.

### What I recommend

Use Railway. I've tried other platforms and Railway is the most straightforward for people who aren't infrastructure experts. You connect your code, set your environment variables, and deploy. It handles the rest.

The first time will feel clunky. The second time will feel routine. By the third app, you'll deploy without even thinking about it.

### Why this matters

An app on your laptop is a demo. An app on the internet is a product. The difference between those two things is leverage.

You can't pitch a demo that only runs on your machine. You can't get user feedback on something nobody can access. You can't prove your idea works if people can't try it.

Deployment is the bridge between "I built something" and "I shipped something." And shipping is where everything changes.

In my paid deployment guide, I walk through the entire process step by step — from localhost to live URL — including exactly how to handle the 5 things that break every time.
