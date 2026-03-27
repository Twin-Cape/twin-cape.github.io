import autoprefixer from 'autoprefixer';

const config = {
  plugins: [
    autoprefixer({
      overrideBrowserslist: [
        'defaults',
        'not ie < 11',
        'last 2 versions',
        '> 1%',
      ],
    }),
  ],
};

export default config;
