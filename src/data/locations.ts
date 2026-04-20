export interface LocationHours {
  day: string;
  hours: string;
  opens?: string;
  closes?: string;
}

export interface Location {
  name: string;
  slug: string;
  badge: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  fullAddress: string;
  phone: string;
  phoneTel: string;
  email: string;
  geo: { lat: number; lng: number };
  hours: LocationHours[];
  openingHoursSpec: Array<{ dayOfWeek: string; opens: string; closes: string }>;
  yelp: { rating: number; count: number; url: string };
  hasOnlineOrdering: boolean;
  hasHappyHour: boolean;
  toastUrl: string;
  doordashUrl: string;
  mapsEmbed: string;
  mapsSearch: string;
  menuUrl: string;
  orderUrl: string;
  socialLinks: { facebook?: string; instagram?: string; yelp: string };
}

export const locations: Record<string, Location> = {
  stockton: {
    name: 'Raw Sushi Bar',
    slug: 'stockton',
    badge: 'ORIGINAL',
    address: '10742 Trinity Parkway, Suite D',
    city: 'Stockton',
    state: 'CA',
    zip: '95219',
    fullAddress: '10742 Trinity Parkway, Suite D, Stockton, CA 95219',
    phone: '(209) 954-9729',
    phoneTel: '2099549729',
    email: 'info@rawsushibar.com',
    geo: { lat: 38.0539256, lng: -121.3729731 },
    hours: [
      { day: 'Monday', hours: '4:30 PM - 8:30 PM', opens: '16:30', closes: '20:30' },
      { day: 'Tuesday', hours: '4:30 PM - 8:30 PM', opens: '16:30', closes: '20:30' },
      { day: 'Wednesday', hours: '4:30 PM - 8:30 PM', opens: '16:30', closes: '20:30' },
      { day: 'Thursday', hours: '4:30 PM - 8:30 PM', opens: '16:30', closes: '20:30' },
      { day: 'Friday', hours: '11:30 AM - 9:00 PM', opens: '11:30', closes: '21:00' },
      { day: 'Saturday', hours: '12:00 PM - 9:00 PM', opens: '12:00', closes: '21:00' },
      { day: 'Sunday', hours: '12:00 PM - 8:00 PM', opens: '12:00', closes: '20:00' },
    ],
    openingHoursSpec: [
      { dayOfWeek: 'Monday', opens: '16:30', closes: '20:30' },
      { dayOfWeek: 'Tuesday', opens: '16:30', closes: '20:30' },
      { dayOfWeek: 'Wednesday', opens: '16:30', closes: '20:30' },
      { dayOfWeek: 'Thursday', opens: '16:30', closes: '20:30' },
      { dayOfWeek: 'Friday', opens: '11:30', closes: '21:00' },
      { dayOfWeek: 'Saturday', opens: '12:00', closes: '21:00' },
      { dayOfWeek: 'Sunday', opens: '12:00', closes: '20:00' },
    ],
    yelp: { rating: 4.5, count: 655, url: 'https://www.yelp.com/biz/raw-sushi-bistro-stockton-2' },
    hasOnlineOrdering: true,
    hasHappyHour: true,
    toastUrl: 'https://order.toasttab.com/online/raw-sushi-bistro-10742-trinity-parkway-suite-d',
    doordashUrl: 'https://www.doordash.com/store/raw-sushi-bistro-892006/',
    mapsEmbed: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3150.315570857948!2d-121.3751618244222!3d38.05607067191632!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x80900ccf4d812bd9%3A0x6bba46c9c6f2a8a1!2sRaw%20Sushi%20Bistro!5e0!3m2!1sen!2sus!4v1708480391234!5m2!1sen!2sus',
    mapsSearch: 'https://www.google.com/maps/search/?api=1&query=10742+Trinity+Parkway+Suite+D+Stockton+CA+95219',
    menuUrl: '/menu/stockton/',
    orderUrl: '/order/stockton/',
    socialLinks: {
      facebook: 'https://www.facebook.com/rawsushibar/',
      instagram: 'https://www.instagram.com/rawsushibistro/',
      yelp: 'https://www.yelp.com/biz/raw-sushi-bistro-stockton-2',
    },
  },
  modesto: {
    name: 'Raw Sushi Bar Modesto',
    slug: 'modesto',
    badge: 'DOWNTOWN',
    address: '1200 I Street',
    city: 'Modesto',
    state: 'CA',
    zip: '95354',
    fullAddress: '1200 I Street, Modesto, CA 95354',
    phone: '(209) 566-9560',
    phoneTel: '2095669560',
    email: 'info@rawsushibar.com',
    geo: { lat: 37.6391, lng: -120.9969 },
    hours: [
      { day: 'Monday', hours: '5:00 PM - 9:00 PM', opens: '17:00', closes: '21:00' },
      { day: 'Tuesday', hours: '11:30 AM - 2:00 PM, 5:00 - 9:00 PM' },
      { day: 'Wednesday', hours: '11:30 AM - 2:00 PM, 5:00 - 9:00 PM' },
      { day: 'Thursday', hours: '11:30 AM - 2:00 PM, 5:00 - 9:00 PM' },
      { day: 'Friday', hours: '11:30 AM - 2:00 PM, 5:00 - 10:00 PM' },
      { day: 'Saturday', hours: '5:00 PM - 10:00 PM', opens: '17:00', closes: '22:00' },
      { day: 'Sunday', hours: 'Closed' },
    ],
    openingHoursSpec: [
      { dayOfWeek: 'Monday', opens: '17:00', closes: '21:00' },
      { dayOfWeek: 'Tuesday', opens: '11:30', closes: '14:00' },
      { dayOfWeek: 'Tuesday', opens: '17:00', closes: '21:00' },
      { dayOfWeek: 'Wednesday', opens: '11:30', closes: '14:00' },
      { dayOfWeek: 'Wednesday', opens: '17:00', closes: '21:00' },
      { dayOfWeek: 'Thursday', opens: '11:30', closes: '14:00' },
      { dayOfWeek: 'Thursday', opens: '17:00', closes: '21:00' },
      { dayOfWeek: 'Friday', opens: '11:30', closes: '14:00' },
      { dayOfWeek: 'Friday', opens: '17:00', closes: '22:00' },
      { dayOfWeek: 'Saturday', opens: '17:00', closes: '22:00' },
    ],
    yelp: { rating: 4.5, count: 791, url: 'https://www.yelp.com/biz/raw-sushi-bistro-modesto' },
    hasOnlineOrdering: false,
    hasHappyHour: false,
    toastUrl: '',
    doordashUrl: 'https://www.doordash.com/store/raw-sushi-bistro-892006/',
    mapsEmbed: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3164.215886542157!2d-121.0016482!3d37.6436069!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x809051fb8d672ea5%3A0x6d90a187fc5e59e!2sRaw%20Sushi%20Bistro!5e0!3m2!1sen!2sus!4v1708480521234!5m2!1sen!2sus',
    mapsSearch: 'https://www.google.com/maps/search/?api=1&query=1200+I+Street+Modesto+CA+95354',
    menuUrl: '/menu/modesto/',
    orderUrl: '',
    socialLinks: {
      yelp: 'https://www.yelp.com/biz/raw-sushi-bistro-modesto',
    },
  },
};

export function getLocation(slug: string): Location {
  return locations[slug];
}

export function getAllLocations(): Location[] {
  return Object.values(locations);
}

export const locationSlugs = Object.keys(locations);
